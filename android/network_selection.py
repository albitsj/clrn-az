"""只读选线与房间初始化诊断：不保存正文、令牌、余额、完整 URL 或用户/房间身份。"""

import json
import re
import time
from urllib.parse import urlsplit

METADATA_PATHS = ('/public/v12/metadata/servers', '/public/v13/metadata/servers')
HEALTH_PATH = '/node/v1/status'


def diagnostic_path(request):
    path = urlsplit(request.path).path
    if path in (*METADATA_PATHS, HEALTH_PATH, '/v2/centrifugo/connection/websocket'):
        return path
    if request.method == 'PUT' and re.fullmatch(r'/v10/wallet/[^/]+', path):
        return '/v10/wallet/{user}'
    if request.method == 'POST' and path == '/v3/pay_action/do':
        return path
    if request.method == 'GET' and re.fullmatch(r'/v1/room/[^/]+', path):
        return '/v1/room/{room}'
    if request.method == 'GET' and re.fullmatch(r'/v10/texas_holdem/room/[^/]+/profile', path):
        return '/v10/texas_holdem/room/{room}/profile'
    return None


def wallet_details(body):
    if not isinstance(body, dict):
        return {}
    result = body.get('result')
    currencies = result.get('currencies') if isinstance(result, dict) else None
    codes = [item.get('code') for item in currencies if isinstance(item, dict)
             and item.get('code') in ('coin', 'diamond')] if isinstance(currencies, list) else None
    return {'walletOk': body.get('ok') if type(body.get('ok')) is bool else None, 'walletCodes': codes}


def ack_frames(message):
    if message.injected or not message.is_text:
        return []
    try:
        decoded = map(json.loads, filter(str.strip, message.text.splitlines()))
        return [frame for frame in decoded if isinstance(frame, dict) and type(frame.get('id')) is int]
    except (ValueError, TypeError):
        return []


def replay_details(message):
    if not message.injected or not message.is_text or message.from_client:
        return []
    frames = [json.loads(line) for line in message.text.splitlines() if line.strip()]
    return [details for frame in frames if (details := replay_frame_details(frame))]


def replay_frame_details(frame):
    if not isinstance(frame, dict) or 'id' in frame:
        return None
    result = frame.get('result')
    if not isinstance(result, dict) or result.get('type', 0) != 0:
        return None
    channel = result.get('channel')
    if not isinstance(channel, str) or not channel.startswith('zhajinhua>'):
        return None
    # 只记录消息数量；不保存频道、用户、房间或回放正文。
    data = result.get('data')
    payload = data.get('data') if isinstance(data, dict) else None
    queue = payload.get('queue') if isinstance(payload, dict) else None
    return {'messages': len(queue)} if isinstance(queue, list) else None


def acknowledged(frame, kind):
    result = frame.get('result')
    if 'error' in frame or not isinstance(result, dict):
        return False
    return kind != 'connect' or (isinstance(result.get('client'), str) and bool(result['client']))


def staging(host):
    return host == 'api.shafayouxi.org' or host.endswith('.api.staging.laiwan.shafayouxi.com')


def request_timing(request):
    started = getattr(request, 'timestamp_start', None)
    return {'requestAt': round(started * 1000)} if type(started) in (int, float) else {}


def network_details(record, path, body):
    if path == HEALTH_PATH and isinstance(body, dict):
        for key in ('backend_delay', 'server_load'):
            value = body.get(key)
            if type(value) in (int, float) or (key == 'server_load' and value in ('normal', 'unavailable')):
                record[key] = value
    if path in METADATA_PATHS and isinstance(body, dict) and isinstance(body.get('result'), dict):
        servers = body['result'].get('servers')
        if isinstance(servers, (dict, list)):
            record['candidates'] = [host for host in servers if isinstance(host, str) and staging(host)]


class NetworkSelection:
    def __init__(self):
        self.events = []
        self.total = 0

    def request(self, flow):
        try:
            if diagnostic_path(flow.request) == HEALTH_PATH:
                self.observe(flow, 'request')
        except Exception:
            pass

    def observe(self, flow, event='response', **details):
        # 复用已有修复的异常隔离，诊断失败不能中断原始响应处理。
        try:
            self._observe(flow, event, **details)
        except Exception:
            pass

    def _observe(self, flow, event, **details):
        path = diagnostic_path(flow.request)
        if not staging(flow.request.host) or path is None:
            return
        record = {'at': round(time.time() * 1000), 'event': event, 'host': flow.request.host,
                  'path': path, 'method': flow.request.method, **request_timing(flow.request), **details}
        if flow.response is not None:
            record['status'] = flow.response.status_code
            try:
                body = flow.response.json()
                if path in ('/v3/pay_action/do', '/v1/room/{room}', '/v10/texas_holdem/room/{room}/profile'):
                    if isinstance(body, dict):
                        record['ok'] = body.get('ok') if type(body.get('ok')) is bool else None
                        record['authenticationFailed'] = body.get('error') == 'authentication_failed'
                if path == '/v10/wallet/{user}':
                    record.update(wallet_details(body))
                network_details(record, path, body)
            except (ValueError, TypeError):
                pass
        self.total += 1
        self.events.append(record)
        del self.events[:-200]

    def websocket_message(self, flow):
        if not flow.websocket or urlsplit(flow.request.path).path != '/v2/centrifugo/connection/websocket':
            return
        message = flow.websocket.messages[-1]
        self.observe_replay(flow, message)
        pending = flow.metadata.setdefault('network_selection_pending', {})
        for frame in ack_frames(message):
            request_id = frame['id']
            if message.from_client:
                if frame.get('method', 0) in (0, 1):
                    pending[request_id] = 'connect' if frame.get('method', 0) == 0 else 'subscribe'
                    if len(pending) > 100:
                        pending.pop(next(iter(pending)))
            else:
                kind = pending.pop(request_id, None)
                if kind and acknowledged(frame, kind):
                    self.observe(flow, 'websocket-ack', kind=kind)

    def observe_replay(self, flow, message):
        try:
            for details in replay_details(message):
                self.observe(flow, 'websocket-replay', **details)
        except Exception:
            pass

    def snapshot(self):
        return {'total': self.total, 'events': list(self.events)}
