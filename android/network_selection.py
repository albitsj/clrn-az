"""只读选线、房间资料与钱包读取诊断：不保存正文、令牌、余额、完整 URL 或用户/房间身份。"""

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
    if request.method == 'GET' and re.fullmatch(r'/v10/texas_holdem/room/[^/]+/profile', path):
        return '/v10/texas_holdem/room/{room}/profile'
    if request.method == 'PUT' and re.fullmatch(r'/v10/wallet/[^/]+', path):
        return '/v10/wallet/{user}'
    return None


def transport_details(flow, event, path):
    if event == 'error' and path in (HEALTH_PATH, '/v10/texas_holdem/room/{room}/profile'):
        return {'failureKind': transport_failure(flow)}
    return {}


def transport_failure(flow):
    # 不复制错误原文；原文可能包含 URL、身份或凭据。
    message = str(getattr(getattr(flow, 'error', None), 'msg', '')).lower()
    for kind, pattern in (('timeout', r'timeout|timed out'), ('tls', r'tls|ssl|certificate'),
                          ('dns', r'resolv|name or service'), ('refused', r'refused'),
                          ('unreachable', r'unreachable|no route'), ('closed', r'closed|reset')):
        if re.search(pattern, message):
            return kind
    return 'other'


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


def acknowledged(frame, kind):
    result = frame.get('result')
    if 'error' in frame or not isinstance(result, dict):
        return False
    return kind != 'connect' or (isinstance(result.get('client'), str) and bool(result['client']))


def staging(host):
    return host == 'api.shafayouxi.org' or host.endswith('.api.staging.laiwan.shafayouxi.com')


class NetworkSelection:
    def __init__(self):
        self.events = []
        self.total = 0
        self.connections = []
        self.connection_total = 0

    def connection(self, host, event, failure_kind=None):
        # 启动首败可能没有 HTTP flow；独立保留 CONNECT/TLS 阶段，不挤掉请求历史。
        try:
            if event not in ('connect', 'tls-client-failed', 'tls-server-failed'):
                return
            if not staging(host):
                return
            record = {'at': round(time.time() * 1000), 'host': host, 'event': event}
            if failure_kind is not None:
                record['failureKind'] = failure_kind
            self.connections.append(record)
            self.connection_total += 1
            del self.connections[:-200]
        except Exception:
            pass

    def tls_failure(self, data, event):
        try:
            peer = data.context.client if event == 'tls-client-failed' else data.context.server
            message = str(getattr(peer, 'error', '') or '').lower()
            kind = next((kind for kind, pattern in (
                ('certificate', r'certificate|unknown ca|unknown_ca'), ('timeout', r'timeout|timed out'),
                ('closed', r'closed|eof|disconnect|reset'), ('cancelled', r'cancel'),
                ('protocol', r'protocol|cipher|version')) if re.search(pattern, message)), 'other')
            self.connection(data.context.server.address[0], event, kind)
        except Exception:
            pass

    def room_profile_request(self, flow):
        try:
            if diagnostic_path(flow.request) in (HEALTH_PATH, '/v10/texas_holdem/room/{room}/profile'):
                self.observe(flow, 'request')
        except Exception:  # 取证不得改变请求路由或测试结果。
            pass

    def observe(self, flow, event='response', **details):
        path = diagnostic_path(flow.request)
        if not staging(flow.request.host) or path is None:
            return
        record = {'at': round(time.time() * 1000), 'event': event, 'host': flow.request.host,
                  'path': path, 'method': flow.request.method, **details}
        record.update(transport_details(flow, event, path))
        if flow.response is not None:
            record['status'] = flow.response.status_code
            try:
                body = flow.response.json()
                if path == '/v10/wallet/{user}':
                    record.update(wallet_details(body))
                if path == HEALTH_PATH and isinstance(body, dict):
                    for key in ('backend_delay', 'server_load'):
                        value = body.get(key)
                        if type(value) in (int, float) or (key == 'server_load' and value in ('normal', 'unavailable')):
                            record[key] = value
                if path in METADATA_PATHS and isinstance(body, dict) and isinstance(body.get('result'), dict):
                    servers = body['result'].get('servers')
                    if isinstance(servers, (dict, list)):
                        record['candidates'] = [host for host in servers if isinstance(host, str) and staging(host)]
            except (ValueError, TypeError):
                pass
        self.total += 1
        self.events.append(record)
        del self.events[:-200]

    def websocket_message(self, flow):
        if not flow.websocket or urlsplit(flow.request.path).path != '/v2/centrifugo/connection/websocket':
            return
        message = flow.websocket.messages[-1]
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

    def snapshot(self):
        return {'total': self.total, 'events': list(self.events),
                'connectionTotal': self.connection_total, 'connections': list(self.connections)}
