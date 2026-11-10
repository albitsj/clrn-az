"""我的战绩独立代理；数据仅匹配控制端指定的账号和固定记录。"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from data import HOUSE, PLAYER
from record_fixtures import RecordFixtures

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '_shared' / 'mitmproxy'))
from proxy_control import ProxyControl  # noqa: E402
from proxy_http import respond as http_respond, is_staging, prepare_profiles, patch_profiles, patch_version  # noqa: E402

CONTROL_HOST = 'test-mitmproxy.invalid'
MODES = ('empty', 'list', 'no-hands', 'paged', 'list-error', 'detail-error', 'delete-error')


def respond(flow, result, status=200, wrapped=True):
    data = {'ok': True, 'result': result} if wrapped else result
    http_respond(flow, data, status)


class GameRecordProxy(ProxyControl, RecordFixtures):
    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.user_id = None
        self.version = 'legacy'
        self.mode = 'empty'
        self.deleted = []
        self.hold = asyncio.Event()
        self.hold.set()
        self.counts = {}
        self.faults = {}
        self.proxied = 0
        self.stabilized = 0

    def status(self):
        return {'scenario': self.scenario, 'interceptedRequests': sum(self.counts.values()),
                'proxiedRequests': self.proxied, 'stabilizedRequests': self.stabilized,
                'recordRequests': self.counts, 'faultRequests': self.faults, 'deleted': self.deleted}

    invalid_command = 'Invalid command'
    release_path = '/records/release'

    def control_reply(self, flow, data, status=200):
        respond(flow, data, status, False)

    def commands(self):
        return {'/records/configure': self.configure_records, '/records/mode': self.configure_mode}

    def reset_scenario(self):
        self.user_id = None
        self.deleted = []
        self.hold.set()

    def release_command(self, body):
        self.hold.set()

    def validate_mode(self, body):
        if body.get('mode') not in MODES or not isinstance(body.get('hold', False), bool):
            raise ValueError('Invalid mode')

    def validate_user(self, user_id):
        if not isinstance(user_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', user_id):
            raise ValueError('Invalid user')

    def configure_records(self, body):
        self.validate_mode(body)
        user_id, version = body.get('userId'), body.get('version')
        self.validate_user(user_id)
        if version not in ('legacy', 'v2'):
            raise ValueError('Invalid version')
        self.user_id, self.version = user_id, version
        self.deleted, self.counts, self.faults = [], {}, {}
        self.configure_mode(body)

    def configure_mode(self, body):
        self.validate_mode(body)
        self.mode = body['mode']
        self.hold.clear() if body.get('hold', False) else self.hold.set()

    def active(self, flow):
        return self.scenario == 'visual-stable' and is_staging(flow.request.host)

    def response(self, flow):
        if not self.active(flow) or not self.user_id:
            return
        path = urlsplit(flow.request.path).path
        self.patch_profiles(flow, path)
        self.patch_version(flow, path)

    def patch_profiles(self, flow, path):
        if path == '/v10/profile/users':
            self.stabilized += patch_profiles(flow, self.user_id, {
                player: {'user_id': player, 'nickname': 'Opponent', 'avatarPath': ''}
                for player in (PLAYER, HOUSE)})

    def patch_version(self, flow, path):
        if (flow.request.method, path) == ('GET', '/public/v11/game_log/available.json'):
            self.stabilized += patch_version(flow, 'v11' if self.version == 'v2' else 'v1')

    async def request(self, flow):
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied += 1
        if self.active(flow):
            await self.fixture_request(flow)

    def prepare_profiles(self, flow):
        return self.user_id and prepare_profiles(flow, self.user_id, (PLAYER, HOUSE))

    async def fixture_request(self, flow):
        if self.prepare_profiles(flow):
            return
        await self.record_request(flow)

    def read_fixture(self, flow, url):
        try:
            body = json.loads(flow.request.content or b'{}')
            return self.fixture(url.path, flow.request.method, body, parse_qs(url.query))
        except (ValueError, TypeError, KeyError, AttributeError):
            return None

    async def record_request(self, flow):
        url = urlsplit(flow.request.path)
        fixture = self.read_fixture(flow, url)
        if fixture is None:
            return
        self.counts[url.path] = self.counts.get(url.path, 0) + 1
        if self.should_hold(url):
            await self.hold.wait()
        self.record_response(flow, fixture, url.path)

    def is_list(self, path):
        return path.endswith('/game_records') or path.endswith('/recent')

    def should_hold(self, url):
        if not self.is_list(url.path):
            return False
        return self.mode != 'paged' or parse_qs(url.query).get('next_page')

    def should_fail(self, path, method):
        failures = {'list-error': self.is_list(path), 'detail-error': self.is_detail(path),
                    'delete-error': method == 'DELETE'}
        return failures.get(self.mode, False)

    def is_detail(self, path):
        return '/play_session_record/' in path and not self.is_list(path)

    def record_response(self, flow, fixture, path):
        if self.should_fail(path, flow.request.method):
            self.faults[path] = self.faults.get(path, 0) + 1
            self.fault_response(flow)
        else:
            respond(flow, fixture)

    def fault_response(self, flow):
        # Legacy HTTP 5xx switches nodes; business errors keep delete failures distinct.
        status = 503 if self.mode == 'list-error' else 200
        respond(flow, {'ok': False, 'error_type': 'visual_record_unavailable',
                       'error_message': 'Visual record service unavailable',
                       'message': 'Visual record service unavailable'}, status, False)


addons = [GameRecordProxy()]
