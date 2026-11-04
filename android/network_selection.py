"""只读选线诊断：不保存请求正文、令牌、完整 URL 或用户/房间身份。"""

import json
import time
from urllib.parse import urlsplit

METADATA_PATHS = ('/public/v12/metadata/servers', '/public/v13/metadata/servers')
HEALTH_PATH = '/node/v1/status'


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

    def observe(self, flow, event='response', **details):
        path = urlsplit(flow.request.path).path
        if not staging(flow.request.host) or path not in (*METADATA_PATHS, HEALTH_PATH,
                                                         '/v2/centrifugo/connection/websocket'):
            return
        record = {'at': round(time.time() * 1000), 'event': event, 'host': flow.request.host,
                  'path': path, 'method': flow.request.method, **details}
        if flow.response is not None:
            record['status'] = flow.response.status_code
            try:
                body = flow.response.json()
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
        return {'total': self.total, 'events': list(self.events)}
