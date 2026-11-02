"""只由命名异常场景启用；健康 67 和业务连接始终访问真实上游。"""

import json
from urllib.parse import urlsplit
from mitmproxy import http
from network_selection import HEALTH_PATH, METADATA_PATHS, staging

SCENES = ('network-64-unavailable', 'network-without-64')


def node_number(host):
    return host.split('.')[0] if isinstance(host, str) and staging(host) else None


class SelectionFaults:
    def __init__(self, scene):
        self.scene = scene if scene in SCENES else None

    def request(self, flow):
        if (self.scene == SCENES[0] and flow.request.method == 'GET'
                and node_number(flow.request.host) in ('64', '68')
                and urlsplit(flow.request.path).path == HEALTH_PATH):
            flow.response = http.Response.make(503, b'Explicit network-64-unavailable test fault',
                                               {'Content-Type': 'text/plain'})
            return True
        return False

    def response(self, flow):
        if (self.scene is None or flow.request.method not in ('GET', 'POST') or not staging(flow.request.host)
                or urlsplit(flow.request.path).path not in METADATA_PATHS
                or not flow.response or flow.response.status_code != 200):
            return
        try:
            body = flow.response.json()
        except ValueError:
            return
        if not isinstance(body, dict) or body.get('ok') is not True or not isinstance(body.get('result'), dict):
            return
        servers = body['result'].get('servers')
        if not isinstance(servers, (list, dict)):
            return
        # 只从上游已有候选取值；不补造地址或将健康失败包装为成功。
        keep = ((lambda host: node_number(host) in ('64', '67', '68')) if self.scene == SCENES[0]
                else (lambda host: node_number(host) != '64'))
        body['result']['servers'] = ({host: value for host, value in servers.items() if keep(host)}
                                     if isinstance(servers, dict) else [host for host in servers if keep(host)])
        flow.response.content = json.dumps(body).encode()
        for header in ('ETag', 'Content-MD5', 'Digest'):
            flow.response.headers.pop(header, None)
