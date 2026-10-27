"""异步查询共用网络夹具，避免等待测试进程时阻塞代理的长连接心跳。"""

import asyncio
import json
import urllib.request


def _read_fixture(url, server, token):
    request = urllib.request.Request(server, data=json.dumps({'url': url}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': token})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


async def fixture_response(url, server, token):
    """在线程中完成夹具查询；响应原样返回，连接和解析错误继续使请求失败。"""
    return await asyncio.to_thread(_read_fixture, url, server, token)
