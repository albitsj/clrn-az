"""使用真实代理和本地上游验证：暂停响应不能把后端耗时串行留到截图完成之后。"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit
from mitmproxy import http
from test_native_network import proxy
from test_network_faults import flow
from test_response_overrides_integration import (HOSTS, ROOT, Upstream, fetch, free_port,
                                               local_upstream, running, upstream_result)


class LaunchResponseBudgetTests(unittest.IsolatedAsyncioTestCase):
    async def test_held_request_reaches_upstream_before_release(self):
        addon = proxy()
        addon.launch.holding = True
        addon.launch.release.clear()
        health = flow(f'https://{HOSTS[1]}/node/v1/status')
        pending = asyncio.create_task(addon.request(health))
        try:
            await asyncio.sleep(0)
            self.assertTrue(pending.done(), '真实上游请求必须在截图等待期间就开始，不得留到释放后才转发')
            self.assertIsNone(health.response, '必须交给真实上游，不能制造成功响应')
            self.assertEqual(addon.launch.requested, 1)
        finally:
            addon.launch.release.set()
            await pending

    async def test_response_hold_preserves_failure_and_cancellation(self):
        addon = proxy()
        addon.launch.holding = True
        addon.launch.release.clear()
        health = flow(f'https://{HOSTS[1]}/node/v1/status')
        health.response = http.Response.make(503, b'upstream-unavailable', {'X-Origin': 'original'})
        response = health.response
        pending = asyncio.create_task(addon.responseheaders(health))
        await asyncio.sleep(0)
        self.assertFalse(pending.done())
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        self.assertIs(health.response, response)
        self.assertEqual((response.status_code, response.content), (503, b'upstream-unavailable'))
        self.assertEqual(response.headers['X-Origin'], 'original')
        addon.launch.release.set()


class ObservedUpstream(Upstream):
    def do_GET(self):
        if urlsplit(self.path).path == '/node/v1/status':
            self.server.health_requests += 1
            self.server.health_seen.set()
        super().do_GET()
        if urlsplit(self.path).path == '/node/v1/status':
            self.server.health_done.set()


class LiveLaunchResponseBudgetTests(unittest.TestCase):
    def test_real_request_is_parallel_and_actual_response_waits_for_release(self):
        environment = {**os.environ, 'MITMPROXY_CONTROL_TOKEN': 'offline-token', 'ANDROID_SCENE': 'pages'}
        port = free_port()
        executable = Path(sys.executable).with_name('mitmdump')
        with patch('test_response_overrides_integration.Upstream', ObservedUpstream), local_upstream() as upstream:
            upstream.health_seen = threading.Event()
            upstream.health_done = threading.Event()
            with tempfile.TemporaryDirectory() as directory, running(
                    [str(executable), '--listen-host', '127.0.0.1', '--listen-port', str(port),
                     '--mode', f'upstream:http://127.0.0.1:{upstream.server_port}', '--set', f'confdir={directory}',
                     '--set', 'connection_strategy=lazy', '--set', 'flow_detail=0', '-s', str(ROOT/'android/proxy-addon.py')],
                    port, 'http://test-mitmproxy.invalid/status', environment):
                for query in ('', '?failed'):
                    with self.subTest(query=query):
                        self.assert_live_response(port, upstream, query)

    def assert_live_response(self, port, upstream, query):
        control = 'http://test-mitmproxy.invalid/android/launch-network'
        health = f'http://{HOSTS[1]}/node/v1/status{query}'
        upstream.health_seen.clear()
        upstream.health_done.clear()
        upstream.health_requests = 0
        self.assertEqual(fetch(port, control, 'POST', {'hold': True})[0], 200)
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(fetch, port, health)
            try:
                self.assertTrue(upstream.health_seen.wait(2), 'hold 期间真实上游必须已经收到唯一请求')
                self.assertTrue(upstream.health_done.wait(2), '真实上游须在暂停期间完成响应')
                with self.assertRaises(TimeoutError, msg='上游已完成，App 仍必须等待显式释放'):
                    pending.result(timeout=0.2)
            finally:
                self.assertEqual(fetch(port, control, 'POST', {'hold': False})[0], 200)
                result = pending.result(timeout=5)
        self.assertEqual(upstream.health_requests, 1, '不得重放上游健康请求')
        expected_status, _, expected_bytes = upstream_result(health, 'GET')
        self.assertEqual((result[0], result[2]), (expected_status, expected_bytes))
        self.assertIsInstance(json.loads(result[2]), dict)
