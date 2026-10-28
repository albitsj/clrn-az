"""真实 mitmdump 直接连接本地上游，验证多节点结果完整透传。"""

from contextlib import contextmanager
import gzip
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
HOSTS = ('64.kr-seoul.api.staging.laiwan.shafayouxi.com',
         '67.hk.api.staging.laiwan.shafayouxi.com', '68.kr.api.staging.laiwan.shafayouxi.com')
METADATA = ('/public/v12/metadata/servers', '/public/v13/metadata/servers')
METADATA_QUERIES = ('', 'without-64', 'failed', 'non-json', 'gzip', 'api-error', 'changed-contract', 'empty')


def upstream_result(url, method):
    """构造与客户端选线输入相同的响应，不在测试中重写应用的选线算法。"""
    parsed = urlsplit(url)
    headers = {'Content-Type': 'application/json', 'X-Upstream': 'real', 'ETag': 'original',
               'Access-Control-Allow-Origin': 'https://app.test',
               'Access-Control-Allow-Headers': 'authorization', 'Vary': 'Origin'}
    if method == 'OPTIONS':
        return 204, headers, b''
    if parsed.path in METADATA:
        servers = {host: f'address-{index}' for index, host in enumerate(HOSTS)}
        if parsed.query == 'without-64':
            servers.pop(HOSTS[0])
        if '/v12/' in parsed.path:
            servers = list(servers)
        body = {'ok': True, 'new_envelope': 42, 'result': {'servers': servers, 'new_field': True}}
    else:
        body = {'backend_delay': 1065 if parsed.hostname == HOSTS[0] else 37,
                'server_load': 'normal', 'new_health': True}
    if parsed.query == 'api-error':
        body = {'ok': False, 'error': 'auth'}
    elif parsed.query == 'changed-contract':
        body = {'ok': True, 'result': []}
    elif parsed.query == 'empty':
        body = {'ok': True, 'result': {'servers': {}}}
    status = 503 if parsed.query == 'failed' or parsed.hostname == HOSTS[2] else 200
    raw = b'<html>Bad Gateway</html>' if parsed.query == 'non-json' else json.dumps(body).encode()
    if parsed.query == 'gzip':
        raw = gzip.compress(raw, mtime=0)
        headers['Content-Encoding'] = 'gzip'
    return status, headers, raw


class Upstream(BaseHTTPRequestHandler):
    def do_GET(self):
        status, headers, raw = upstream_result(self.path, self.command)
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    do_OPTIONS = do_GET

    def log_message(self, *_args):
        pass


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def fetch(port, url, method='GET', body=None):
    client = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    try:
        client.request(method, url, None if body is None else json.dumps(body),
                       {'X-E2E-Control-Token': 'offline-token', 'Content-Type': 'application/json',
                        'Authorization': 'offline-fixture-token', 'Origin': 'https://app.test',
                        'Access-Control-Request-Headers': 'authorization'})
        response = client.getresponse()
        return response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
    finally:
        client.close()


@contextmanager
def running(command, port, url, environment, method='GET', body=None):
    """有界等待真实服务启动；失败时保留子进程日志，所有退出路径清理。"""
    with tempfile.TemporaryFile() as logs:
        process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=logs, stderr=logs)
        try:
            deadline = time.monotonic() + 15
            while True:
                try:
                    status, _, _ = fetch(port, url, method, body)
                    if status != 200:
                        raise OSError(f'Startup returned {status}')
                    break
                except OSError:
                    if process.poll() is not None or time.monotonic() >= deadline:
                        logs.seek(0)
                        raise AssertionError('Service startup failed: ' + logs.read().decode()[-4000:])
                    time.sleep(0.1)
            yield
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


class LiveOverrideTests(unittest.TestCase):
    def test_all_addons_preserve_live_upstream_responses(self):
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        worker = threading.Thread(target=upstream.serve_forever, daemon=True)
        worker.start()
        try:
            for addon in ('e2e/mitmproxy/network_faults.py',
                          'visual/cases/club/mitmproxy/addon.py',
                          'visual/cases/texas-holdem/mitmproxy/addon.py',
                          'visual/cases/zhajinhua/mitmproxy/addon.py',
                          'visual/cases/game-record/mitmproxy/addon.py'):
                with self.subTest(addon=addon):
                    self.check_addon(upstream.server_port, addon)
            for game, records in (('', 'false'), ('texas-holdem', 'false'),
                                  ('zhajinhua', 'false'), ('', 'true')):
                with self.subTest(native_game=game, records=records):
                    self.check_addon(upstream.server_port, 'android/proxy-addon.py', {
                        'ANDROID_SCENE': game or ('records' if records == 'true' else 'pages'),
                    })
        finally:
            upstream.shutdown()
            upstream.server_close()
            worker.join(timeout=5)

    def check_addon(self, upstream_port, addon, native=None):
        port = free_port()
        executable = Path(sys.executable).with_name('mitmdump')
        environment = {**os.environ, 'MITMPROXY_CONTROL_TOKEN': 'offline-token',
                       'ANDROID_SCENE': 'pages',
                       **(native or {})}
        with tempfile.TemporaryDirectory() as directory, running(
                [str(executable), '--listen-host', '127.0.0.1', '--listen-port', str(port),
                 '--mode', f'upstream:http://127.0.0.1:{upstream_port}', '--set', f'confdir={directory}',
                 '--set', 'connection_strategy=lazy', '--set', 'flow_detail=0', '-s', str(ROOT / addon)],
                port, 'http://test-mitmproxy.invalid/status', environment):
            # 登录准备（未启用业务场景）及正常视觉都不覆盖选线。
            if native is None:
                self.assert_passthrough(port)
                self.assertEqual(fetch(port, 'http://test-mitmproxy.invalid/scenario', 'POST',
                                       {'scenario': 'visual-stable'})[0], 200)
            self.assert_passthrough(port)
            if native is not None:
                for path, expected in (
                        ('/public/v10/profile/country', {'countryPhoneCode': '86'}),
                        ('/v2/room/disallow-rule/reminder', {'enable': False, 'message': ''}),
                        ('/public/v1/hall_matching/available.json', {'available_url_version': ['v3']})):
                    status, headers, raw = fetch(port, 'http://api.shafayouxi.org' + path)
                    self.assertEqual(status, 200)
                    self.assertEqual(headers['content-type'], 'application/json')
                    self.assertEqual(json.loads(raw), {'ok': True, 'result': expected})
                status, _, raw = fetch(port, 'http://api.shafayouxi.org/v10/alipay_order/goods')
                self.assertEqual(status, 200)
                self.assertEqual(len(json.loads(raw)['result']), 7)
                self.assertEqual(fetch(port, 'http://api.shafayouxi.org/v10/alipay_order', 'POST', {})[0], 403)

    def assert_passthrough(self, port):
        urls = [f'http://api.shafayouxi.org{path}?{query}' for path in METADATA
                for query in METADATA_QUERIES]
        urls += [f'http://{host}/node/v1/status?{query}' for host in HOSTS
                 for query in ('', 'failed', 'non-json', 'gzip')]
        for url in urls:
            for method in ('GET', 'OPTIONS'):
                with self.subTest(url=url, method=method):
                    status, headers, raw = fetch(port, url, method)
                    expected_status, expected_headers, expected_raw = upstream_result(url, method)
                    self.assertEqual(status, expected_status)
                    self.assertEqual(raw, expected_raw, '必须保留所有候选、健康指标、错误和原始压缩字节')
                    for key, value in expected_headers.items():
                        self.assertEqual(headers[key.lower()], value)


if __name__ == '__main__':
    unittest.main()
