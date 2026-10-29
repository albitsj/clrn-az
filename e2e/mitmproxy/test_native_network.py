"""从 Android 生产入口验证换线回放与启动暂缓边界，不运行 APK。"""

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from mitmproxy import http, websocket
from wsproto.frame_protocol import Opcode
from test_network_faults import flow
from test_response_overrides_integration import HOSTS, METADATA, METADATA_QUERIES, upstream_result

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'android'))
spec = importlib.util.spec_from_file_location('native_entrypoint', ROOT / 'android/proxy-addon.py')
native = importlib.util.module_from_spec(spec)
with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token', 'ANDROID_SCENE': 'pages'}):
    spec.loader.exec_module(native)

ROOM = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
SELF = '33333333-3333-4333-8333-333333333333'


def message(socket, frames, from_client=True):
    msg = websocket.WebSocketMessage(Opcode.TEXT, from_client,
                                     '\n'.join(json.dumps(frame) for frame in frames).encode())
    socket.websocket.messages.append(msg)
    return msg


def proxy(game='', records=False):
    with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token',
                                'ANDROID_SCENE': game or ('records' if records else 'pages')}):
        return native.AndroidVisualProxy()


class NativeReplayTests(unittest.IsolatedAsyncioTestCase):
    async def test_named_modes_are_exclusive_and_invalid_modes_fail(self):
        for scene in ('pages', 'records', 'texas-holdem', 'zhajinhua', 'matching', 'slot', 'skeleton', 'invitable'):
            addon = proxy(scene)
            for flag in ('matching', 'slot', 'skeleton', 'invitable'):
                self.assertEqual(getattr(addon, flag), scene == flag, (scene, flag))
            self.assertEqual(addon.records is not None, scene == 'records')
            self.assertEqual(addon.game is not None, scene in ('texas-holdem', 'zhajinhua'))
        with self.assertRaises(ValueError):
            proxy('unknown')

    async def test_all_native_modes_preserve_candidates_health_errors_and_preflight(self):
        urls = [f'https://api.shafayouxi.org{path}?{query}' for path in METADATA
                for query in METADATA_QUERIES]
        urls += [f'https://{host}/node/v1/status?{query}' for host in HOSTS
                 for query in ('', 'failed', 'non-json', 'gzip')]
        for game, records in (('', False), ('texas-holdem', False), ('zhajinhua', False), ('', True)):
            addon = proxy(game, records)
            for url in urls:
                for method in ('GET', 'OPTIONS'):
                    with self.subTest(game=game, records=records, url=url, method=method):
                        request = flow(url, method)
                        await addon.request(request)
                        self.assertIsNone(request.response)
                        self.assertIsNone(request.error)
                        status, headers, raw = upstream_result(url, method)
                        request.response = http.Response.make(status, raw, headers)
                        before = request.response.get_state()
                        addon.response(request)
                        self.assertEqual(request.response.get_state(), before)

    async def test_node_switch_replays_only_current_room_on_confirmed_connection(self):
        for game, stream in (('texas-holdem', 'texas_holdem'), ('zhajinhua', 'zhajinhua')):
            addon = proxy(game)
            replay = addon.game.texas if game == 'texas-holdem' else addon.game.replay
            # 房间归属已由真实建房响应确认；不重新实现现有建房契约测试。
            if game == 'texas-holdem':
                replay.arm_created_room(ROOM, SELF)
            else:
                addon.game.created_room_id = ROOM
            previous = None
            channel = f'{stream}>{ROOM}#{SELF}'
            other_channel = f'{stream}>{OTHER}#{SELF}'
            for host in HOSTS:
                with self.subTest(game=game, host=host):
                    if previous:
                        addon.websocket_end(previous)
                        previous.websocket.timestamp_end = 123
                    socket = flow(f'https://{host}/v2/centrifugo/connection/websocket')
                    socket.websocket = websocket.WebSocketData()
                    message(socket, [{'id': 1, 'method': 1, 'params': {'channel': channel}},
                                     {'id': 2, 'method': 1, 'params': {'channel': other_channel}}])
                    addon.websocket_message(socket)
                    command = flow(f'http://test-mitmproxy.invalid/{game.split("-")[0]}/replay', 'POST',
                                   json.dumps({'roomId': ROOM, 'scene': {'scene': 'table'}}).encode(),
                                   'test-token')
                    with patch('mitmproxy.ctx.master', create=True) as master:
                        await addon.request(command)
                        self.assertEqual(command.response.status_code, 400, '订阅确认前不得回放')
                        master.commands.call.assert_not_called()
                        message(socket, [{'id': 1, 'result': {}}, {'id': 2, 'result': {}}], False)
                        addon.websocket_message(socket)
                        command.response = None
                        await addon.request(command)
                        self.assertEqual(command.response.status_code, 200)
                        master.commands.call.assert_called_once()
                        args = master.commands.call.call_args.args
                        self.assertEqual(args[:3], ('inject.websocket', socket, True))
                        published = json.loads(args[3])['result']
                        self.assertEqual(published['channel'], channel)
                        queue = published['data']['data']['queue']
                        self.assertEqual(queue[0]['event'], 'room_status')
                        self.assertEqual(queue[1]['status']['seats'][0]['player']['player_id'], SELF)
                        self.assertEqual(queue[-1]['event'], 'hand_analyse' if game == 'texas-holdem' else 'table_status')
                        for body, token, expected in (
                                ({'roomId': ROOM, 'data': {'stream': stream, 'queue': []}}, 'test-token', 400),
                                ({'roomId': ROOM, 'scene': {'scene': 'missing'}}, 'test-token', 400),
                                ({'roomId': ROOM, 'scene': {'scene': 'table', 'queue': []}}, 'test-token', 400),
                                ({'roomId': ROOM, 'scene': {'scene': 'table'}}, None, 403)):
                            invalid = flow(command.request.pretty_url, 'POST', json.dumps(body).encode(), token)
                            await addon.request(invalid)
                            self.assertEqual(invalid.response.status_code, expected)
                            self.assertEqual(master.commands.call.call_count, 1)
                        foreign = flow(command.request.pretty_url, 'POST', json.dumps({
                            'roomId': OTHER, 'scene': {'scene': 'table'}}).encode(), 'test-token')
                        await addon.request(foreign)
                        self.assertEqual(foreign.response.status_code, 400)
                        self.assertEqual(master.commands.call.call_count, 1)
                    other_push = {'result': {'type': 0, 'channel': other_channel, 'data': {}}}
                    untouched = message(socket, [other_push], False)
                    addon.websocket_message(socket)
                    self.assertFalse(untouched.dropped)
                    self.assertEqual(json.loads(untouched.content), other_push)
                    previous = socket

    async def test_network_diagnostics_are_authenticated_read_only_and_keep_failures(self):
        addon = proxy()
        health = flow(f'https://{HOSTS[2]}/node/v1/status?api_token=secret')
        health.response = http.Response.make(503, b'not-json')
        addon.response(health)
        addon.error(flow(f'https://{HOSTS[0]}/node/v1/status'))
        with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            for method, token, expected in (('GET', None, 403), ('POST', 'test-token', 405),
                                            ('GET', 'test-token', 200)):
                control = flow('http://test-mitmproxy.invalid/android/network-selection', method, token=token)
                await addon.request(control)
                self.assertEqual(control.response.status_code, expected)
            result = control.response.json()
            self.assertEqual(result['total'], 2)
            self.assertEqual(result['events'][0]['status'], 503)
            self.assertEqual(result['events'][1]['event'], 'error')
            self.assertNotIn('secret', json.dumps(result))

    async def test_launch_hold_is_explicit_get_only_and_release_preserves_upstream(self):
        addon = proxy()
        environment = {'MITMPROXY_CONTROL_TOKEN': 'test-token'}
        with patch.dict(os.environ, environment):
            health = flow(f'https://{HOSTS[1]}/node/v1/status')
            await addon.request(health)
            self.assertIsNone(health.response)
            self.assertEqual(addon.launch.requested, 0)
            hold = flow('http://test-mitmproxy.invalid/android/launch-network', 'POST', b'{"hold":true}', 'test-token')
            await addon.request(hold)
            preflight = flow(health.request.pretty_url, 'OPTIONS')
            await addon.request(preflight)
            self.assertIsNone(preflight.response)
            pending = asyncio.create_task(addon.request(health))
            try:
                await asyncio.sleep(0)
                self.assertEqual(addon.launch.requested, 1)
                self.assertFalse(pending.done())
            finally:
                release = flow(hold.request.pretty_url, 'POST', b'{"hold":false}', 'test-token')
                await addon.request(release)
                await asyncio.wait_for(pending, 1)
            self.assertIsNone(health.response, '释放后健康请求仍须访问上游')


if __name__ == '__main__':
    unittest.main()
