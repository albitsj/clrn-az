"""只读选线诊断：不保存请求正文、令牌、完整 URL 或用户/房间身份。"""

import time
from urllib.parse import urlsplit

METADATA_PATHS = ('/public/v12/metadata/servers', '/public/v13/metadata/servers')
HEALTH_PATH = '/node/v1/status'


def staging(host):
    return host == 'api.shafayouxi.org' or host.endswith('.api.staging.laiwan.shafayouxi.com')


class NetworkSelection:
    def __init__(self):
        self.events = []
        self.total = 0

    def observe(self, flow, event='response'):
        path = urlsplit(flow.request.path).path
        if not staging(flow.request.host) or path not in (*METADATA_PATHS, HEALTH_PATH,
                                                         '/v2/centrifugo/connection/websocket'):
            return
        record = {'at': round(time.time() * 1000), 'event': event, 'host': flow.request.host,
                  'path': path, 'method': flow.request.method}
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

    def snapshot(self):
        return {'total': self.total, 'events': list(self.events)}
