"""只在专用模拟器的代理边界复用 Web 响应，不改变 APK 或绕过应用初始化。"""

import importlib.util
import json
import os
import re
import sys
from pathlib import Path
import urllib.request
from urllib.parse import urlsplit
from mitmproxy import ctx, http
from presentation import AccountPresentation
from game_session import GameSession


class AndroidVisualProxy:
    def __init__(self):
        self.presentation = AccountPresentation()
        self.records = None
        self.game = None
        self.game_session = None
        self.matching = os.environ.get('ANDROID_MATCHING') == 'true'
        self.matching_paths = {'/v1/hall_matching/join', '/v1/hall_matching/quit',
                               '/v1/hall_matching/keep_waiting'}
        self.slot = os.environ.get('ANDROID_SLOT') == 'true'
        self.slot_currency = 'coin'
        self.slot_no_energy = False
        self.slot_spins = 0
        game_type = os.environ.get('ANDROID_GAME')
        if game_type in ('texas-holdem', 'zhajinhua'):
            directory = Path(__file__).resolve().parents[1] / 'visual/cases' / game_type / 'mitmproxy'
            sys.path.insert(0, str(directory))
            spec = importlib.util.spec_from_file_location('native_game_addon', directory / 'addon.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.game = module.TexasVisualProxy() if game_type == 'texas-holdem' else module.ZhajinhuaVisualProxy()
            self.game.scenario = 'visual-stable'
            self.game_session = GameSession('texas_holdem' if game_type == 'texas-holdem' else 'zhajinhua')
        if os.environ.get('ANDROID_RECORDS') == 'true':
            sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'visual/cases/game-record/mitmproxy'))
            from addon import GameRecordProxy
            self.records = GameRecordProxy()
            self.records.scenario = 'visual-stable'

    def response(self, flow):
        if (not flow.response or flow.response.status_code != 200
                or (flow.request.host != 'api.shafayouxi.org'
                    and not flow.request.host.endswith('.api.staging.laiwan.shafayouxi.com'))):
            return
        if self.game:
            self.game_session.response(flow)
            self.game.response(flow)
        try:
            body = flow.response.json()
        except ValueError:
            return
        path = urlsplit(flow.request.path).path
        normalized = self.presentation.normalize(path, flow.request.method, body)
        if self.game_session:
            normalized = self.game_session.normalize_room(path, flow.request.method, body) or normalized
        if normalized:
            flow.response.content = json.dumps(body).encode()
            for header in ('ETag', 'Content-MD5', 'Digest'):
                flow.response.headers.pop(header, None)
        if self.records:
            if self.presentation.user_id:
                self.records.user_id = self.presentation.user_id
            self.records.response(flow)

    def websocket_message(self, flow):
        if self.slot and flow.websocket:
            message = flow.websocket.messages[-1]
            if message.from_client and message.is_text and not message.injected:
                try:
                    frames = [json.loads(line) for line in message.text.splitlines() if line]
                except (ValueError, TypeError):
                    frames = []
                blocked = [frame for frame in frames if isinstance(frame, dict)
                           and frame.get('method') == 9 and isinstance(frame.get('params'), dict)
                           and isinstance(frame['params'].get('data'), dict)
                           and re.fullmatch(r'/v2/slot_machine/user/[^/]+/(energy|spin)',
                                            str(frame['params']['data'].get('path'))) is not None]
                if blocked:
                    kept = [frame for frame in frames if frame not in blocked]
                    if kept:
                        message.content = '\n'.join(json.dumps(frame) for frame in kept).encode()
                    else:
                        message.drop()
                    replies = []
                    for frame in blocked:
                        path = frame['params']['data']['path']
                        user_id = path.split('/')[4]
                        valid_user = self.presentation.user_id and user_id == self.presentation.user_id
                        data = self.slot_result(path.endswith('/spin')) if valid_user else {
                            'ok': False, 'error': 'unknown_user'}
                        if isinstance(frame.get('id'), int):
                            replies.append({'id': frame['id'], 'result': {'data': data}})
                    if replies:
                        ctx.master.commands.call('inject.websocket', flow, True,
                                                 '\n'.join(json.dumps(reply) for reply in replies).encode(), True)
        if self.matching and flow.websocket:
            message = flow.websocket.messages[-1]
            if message.from_client and message.is_text and not message.injected:
                try:
                    frames = [json.loads(line) for line in message.text.splitlines() if line]
                except (ValueError, TypeError):
                    frames = []
                blocked = [frame for frame in frames if isinstance(frame, dict)
                           and frame.get('method') == 9 and isinstance(frame.get('params'), dict)
                           and isinstance(frame['params'].get('data'), dict)
                           and frame['params']['data'].get('path') in self.matching_paths]
                if blocked:
                    kept = [frame for frame in frames if frame not in blocked]
                    if kept:
                        message.content = '\n'.join(json.dumps(frame) for frame in kept).encode()
                    else:
                        message.drop()
                    replies = [{'id': frame['id'], 'result': {'data': {'ok': True, 'result': {}}}}
                               for frame in blocked if isinstance(frame.get('id'), int)]
                    if replies:
                        ctx.master.commands.call('inject.websocket', flow, True,
                                                 '\n'.join(json.dumps(reply) for reply in replies).encode(), True)
        if self.game:
            self.game.websocket_message(flow)

    def websocket_end(self, flow):
        if self.game:
            self.game.websocket_end(flow)

    async def request(self, flow):
        if self.slot and flow.request.host == 'test-mitmproxy.invalid' and urlsplit(flow.request.path).path == '/android/slot':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
                return
            if flow.request.method == 'POST':
                try:
                    settings = json.loads(flow.request.content)
                except (ValueError, TypeError):
                    settings = {}
                if settings.get('currency') not in ('coin', 'currency_diamond', 'energy'):
                    flow.response = http.Response.make(400, b'Invalid slot currency')
                    return
                self.slot_currency = settings['currency']
                self.slot_no_energy = settings.get('noEnergy') is True
            flow.response = http.Response.make(200, json.dumps({'spins': self.slot_spins,
                'currency': self.slot_currency, 'noEnergy': self.slot_no_energy}).encode(),
                {'Content-Type': 'application/json'})
            return
        if self.slot and re.fullmatch(r'/v10/wallet/[^/]+', urlsplit(flow.request.path).path) \
                and flow.request.method == 'PUT':
            requested_user = urlsplit(flow.request.path).path.split('/')[3]
            if not self.presentation.user_id or requested_user != self.presentation.user_id:
                flow.response = http.Response.make(403, b'Unknown slot account')
                return
            wallet = {'ok': True, 'result': {'currencies': [
                {'code': 'coin', 'name': '金币', 'balance': '10000'},
                {'code': 'diamond', 'name': '钻石', 'balance': '60'}]}}
            flow.response = http.Response.make(200, json.dumps(wallet).encode(),
                {'Content-Type': 'application/json'})
            return
        if self.slot and re.fullmatch(r'/v2/slot_machine/user/[^/]+/(energy|spin)',
                                      urlsplit(flow.request.path).path):
            path = urlsplit(flow.request.path).path
            valid_user = self.presentation.user_id and path.split('/')[4] == self.presentation.user_id
            data = self.slot_result(path.endswith('/spin')) if valid_user else {'ok': False, 'error': 'unknown_user'}
            flow.response = http.Response.make(200, json.dumps(data).encode(), {'Content-Type': 'application/json'})
            return
        if self.matching and urlsplit(flow.request.path).path in self.matching_paths:
            flow.response = http.Response.make(200, b'{"ok":true,"result":{}}',
                                               {'Content-Type': 'application/json'})
            return
        if self.game and flow.request.host == 'test-mitmproxy.invalid' and urlsplit(flow.request.path).path == '/android/session':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
            else:
                flow.response = http.Response.make(200, json.dumps({
                    'account': self.game_session.account, 'room': self.game_session.room}).encode(),
                    {'Content-Type': 'application/json'})
            return
        if self.game:
            self.game.request(flow)
            if flow.response:
                return
        if self.records:
            await self.records.request(flow)
            if flow.response:
                return
        if flow.request.host == 'test-mitmproxy.invalid':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
            else:
                flow.response = http.Response.make(200, b'{"scenario":"visual-stable"}')
            return
        if flow.request.method == 'CONNECT':
            return
        payload = json.dumps({'url': flow.request.pretty_url}).encode()
        request = urllib.request.Request(os.environ['ANDROID_FIXTURE_URL'], data=payload,
            headers={'Content-Type': 'application/json',
                     'Authorization': os.environ['ANDROID_FIXTURE_TOKEN']})
        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.load(response)
        if result is None:
            return
        if result.get('aborted'):
            flow.kill()
            return
        flow.response = http.Response.make(result.get('status', 200),
            result.get('body', '').encode(),
            {'Content-Type': result.get('contentType', 'application/json')})

    def slot_result(self, spin):
        energy = {'user_energy': {'total_energy': 0}, 'energy_factory': {
            'capacity': 50, 'quantity': 50, 'remaining_production_time': '00:00:00'}}
        if not spin:
            return {'ok': True, 'result': energy}
        self.slot_spins += 1
        if self.slot_no_energy:
            return {'ok': False, 'error': 'energy_not_enough', 'error_description': 'No energy'}
        currency = self.slot_currency
        return {'ok': True, 'result': {**energy, 'outcome': [currency, currency, currency],
            'reward': {'outcome_pattern': 'three', 'prize': {
                'coin': 100 if currency == 'coin' else 0,
                'diamond': 5 if currency == 'currency_diamond' else 0,
                'energy': 10 if currency == 'energy' else 0}}}}


addons = [AndroidVisualProxy()]
