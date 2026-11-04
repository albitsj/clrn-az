"""从原生入口验证异常模式边界，以及 ACK 来自对应连接的真实成功响应。"""

import json
from itertools import product
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from mitmproxy import http, websocket
from test_native_network import proxy, message
from test_network_faults import flow
from test_response_overrides_integration import HOSTS, METADATA, ROOT, Upstream, fetch, free_port, running, upstream_result


class SelectionFaultTests(unittest.IsolatedAsyncioTestCase):
    def assert_upstream_unchanged(self, addon, request):
        status, headers, raw = upstream_result(request.request.pretty_url, request.request.method)
        request.response = http.Response.make(status, raw, headers)
        upstream_state = request.response.get_state()
        addon.response(request)
        self.assertEqual(request.response.get_state(), upstream_state)

    async def test_explicit_faults_filter_real_metadata_and_only_fail_seoul_health(self):
        for scene in ('network-64-unavailable', 'network-without-64'):
            addon = proxy(scene)
            for path, method in product(METADATA, ('GET', 'POST')):
                request = flow(f'https://api.shafayouxi.org{path}', method)
                await addon.request(request)
                self.assertIsNone(request.response)
                status, headers, raw = upstream_result(request.request.pretty_url, 'GET')
                request.response = http.Response.make(status, raw, headers)
                addon.response(request)
                body = request.response.json()
                original = json.loads(raw)
                expected = HOSTS if scene == 'network-64-unavailable' else HOSTS[1:]
                self.assertEqual(list(body['result']['servers']), list(expected))
                if isinstance(body['result']['servers'], dict):
                    for host in expected:
                        self.assertEqual(body['result']['servers'][host], original['result']['servers'][host])
                self.assertEqual(body['new_envelope'], original['new_envelope'])
                self.assertEqual(addon.network_selection.events[-1]['candidates'], list(expected))
            for host in HOSTS:
                request = flow(f'https://{host}/node/v1/status')
                await addon.request(request)
                if scene == 'network-64-unavailable' and host in (HOSTS[0], HOSTS[2]):
                    self.assertEqual(request.response.status_code, 503)
                else:
                    self.assertIsNone(request.response)
                    self.assert_upstream_unchanged(addon, request)

    async def test_faults_preserve_preflight_errors_and_unrelated_requests(self):
        for scene in ('network-64-unavailable', 'network-without-64'):
            addon = proxy(scene)
            for host, path, method in (
                    (HOSTS[0], '/node/v1/status', 'OPTIONS'),
                    (HOSTS[0], '/node/v1/status', 'POST'),
                    ('api.example.com', METADATA[0], 'GET'),
                    ('api.shafayouxi.org', METADATA[0], 'OPTIONS'),
                    (HOSTS[0], '/v2/centrifugo/connection/websocket', 'GET')):
                request = flow(f'https://{host}{path}', method)
                await addon.request(request)
                self.assertIsNone(request.response)
                request.response = http.Response.make(200, b'{"ok":true,"result":{"servers":["other"]}}')
                before = request.response.get_state()
                addon.response(request)
                self.assertEqual(request.response.get_state(), before)
            for query in ('failed', 'non-json', 'api-error', 'changed-contract'):
                request = flow(f'https://api.shafayouxi.org{METADATA[0]}?{query}')
                self.assert_upstream_unchanged(addon, request)

    async def test_ack_requires_matching_real_success_on_same_connection(self):
        addon = proxy()
        sockets = [flow(f'https://{host}/v2/centrifugo/connection/websocket?token=secret') for host in HOSTS[:2]]
        for socket in sockets:
            socket.websocket = websocket.WebSocketData()
        first, second = sockets
        message(first, [{'id': 1, 'params': {'token': 'secret'}}])
        addon.websocket_message(first)
        for socket, frames in ((second, [{'id': 1, 'result': {'client': 'secret'}}]),
                               (first, [{'id': 2, 'result': {}}]),
                               (first, [{'id': 1, 'error': {'message': 'secret'}}])):
            message(socket, frames, False)
            addon.websocket_message(socket)
        self.assertEqual(addon.network_selection.total, 0)
        message(second, [{'id': 3, 'method': 0, 'params': {'token': 'secret'}},
                         {'id': 4, 'method': 1, 'params': {'channel': 'secret'}}])
        addon.websocket_message(second)
        message(second, [{'id': 3, 'result': {'client': 'secret'}}, {'id': 4, 'result': {}}], False)
        addon.websocket_message(second)
        self.assertEqual([event['kind'] for event in addon.network_selection.events], ['connect', 'subscribe'])
        self.assertTrue(all(event['host'] == HOSTS[1] for event in addon.network_selection.events))
        self.assertNotIn('secret', json.dumps(addon.network_selection.snapshot()))
        second.websocket.messages[-1].injected = True
        addon.websocket_message(second)
        self.assertEqual(addon.network_selection.total, 2)


class LiveSelectionFaultTests(unittest.TestCase):
    def test_real_native_proxy_serves_faults_and_preserves_healthy_upstream(self):
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        worker = threading.Thread(target=upstream.serve_forever, daemon=True)
        worker.start()
        try:
            for scene in ('network-64-unavailable', 'network-without-64'):
                self.check_scene(upstream.server_port, scene)
        finally:
            upstream.shutdown()
            upstream.server_close()
            worker.join(timeout=5)

    def check_scene(self, upstream_port, scene):
        port = free_port()
        environment = {**os.environ, 'MITMPROXY_CONTROL_TOKEN': 'offline-token', 'ANDROID_SCENE': scene}
        with tempfile.TemporaryDirectory() as directory, running(
                [str(Path(sys.executable).with_name('mitmdump')), '--listen-host', '127.0.0.1',
                 '--listen-port', str(port), '--mode', f'upstream:http://127.0.0.1:{upstream_port}',
                 '--set', f'confdir={directory}', '--set', 'connection_strategy=lazy',
                 '-s', str(ROOT / 'android/proxy-addon.py')],
                port, 'http://test-mitmproxy.invalid/status', environment):
            for path, method in product(METADATA, ('GET', 'POST')):
                status, _, raw = fetch(port, f'http://api.shafayouxi.org{path}', method)
                self.assertEqual(status, 200)
                expected = HOSTS if scene == 'network-64-unavailable' else HOSTS[1:]
                self.assertEqual(list(json.loads(raw)['result']['servers']), list(expected))
            for host in HOSTS:
                url = f'http://{host}/node/v1/status'
                status, _, raw = fetch(port, url)
                if scene == 'network-64-unavailable' and host in (HOSTS[0], HOSTS[2]):
                    self.assertEqual(status, 503)
                else:
                    expected_status, _, expected_raw = upstream_result(url, 'GET')
                    self.assertEqual((status, raw), (expected_status, expected_raw))
                self.assertEqual(fetch(port, url, 'OPTIONS')[0], 204)


if __name__ == '__main__':
    unittest.main()
