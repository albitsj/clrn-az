"""验证慢夹具不会阻塞代理事件循环，且不会把失败响应改成成功。"""

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import unittest
import urllib.error

from fixture_bridge import fixture_response


class FixtureHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.server.received = {
            'authorization': self.headers.get('Authorization'),
            'body': json.loads(self.rfile.read(int(self.headers['Content-Length']))),
        }
        self.server.started.set()
        self.server.release.wait(timeout=5)
        self.send_response(self.server.status)
        self.end_headers()
        self.wfile.write(self.server.body)

    def log_message(self, *_arguments):
        pass


class FixtureBridgeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
        self.server.started = threading.Event()
        self.server.release = threading.Event()
        self.server.status = 200
        self.server.body = b'{"status":200,"body":"fixture"}'
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}/'

    async def asyncTearDown(self):
        self.server.release.set()
        await asyncio.to_thread(self.server.shutdown)
        self.server.server_close()
        self.worker.join(timeout=2)

    async def test_等待夹具期间事件循环仍可运行并保留请求与响应(self):
        target = 'https://fixture.example/visual'
        pending = asyncio.create_task(fixture_response(target, self.url, 'fixture-token'))
        try:
            started = await asyncio.to_thread(self.server.started.wait, 3)
            self.assertTrue(started, '夹具服务必须收到本轮请求')
            self.assertFalse(pending.done(), '服务尚未释放响应时，事件循环必须能继续运行')
        finally:
            self.server.release.set()
            result = await asyncio.wait_for(pending, timeout=5)
        self.assertEqual(self.server.received, {
            'authorization': 'fixture-token', 'body': {'url': target},
        }, '查询必须保留目标地址和夹具认证信息')
        self.assertEqual(result, {'status': 200, 'body': 'fixture'}, '夹具响应必须原样返回')

    async def test_未命中夹具时保留透传结果(self):
        self.server.body = b'null'
        self.server.release.set()
        result = await fixture_response('https://fixture.example/unmatched', self.url, 'fixture-token')
        self.assertIsNone(result, '未命中的请求必须继续交由真实上游处理')

    async def test_服务错误和无效正文继续向调用方传播(self):
        self.server.release.set()
        self.server.status = 503
        with self.assertRaises(urllib.error.HTTPError, msg='服务失败不能被改成成功夹具') as failure:
            await fixture_response('https://fixture.example/error', self.url, 'fixture-token')
        failure.exception.close()
        self.server.status = 200
        self.server.body = b'not-json'
        with self.assertRaises(json.JSONDecodeError, msg='无效正文必须保留解析错误'):
            await fixture_response('https://fixture.example/invalid', self.url, 'fixture-token')


if __name__ == '__main__':
    unittest.main()
