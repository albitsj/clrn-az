"""仅为俱乐部房间有数据截图提供固定业务响应，并保留独立代理的选址稳定化。"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from mitmproxy import http

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '_shared' / 'mitmproxy'))
from proxy_http import ProxyHTTP, respond  # noqa: E402

CONTROL_HOST = 'test-mitmproxy.invalid'
CLUB_IDENTIFIER = '00000000-0000-4000-8000-000000000151'
CLUB_NAME = '演示俱乐部'
CLUB_ROOMS = [
    {
        'room_id': 'visual-club-room-one', 'room_name': '德州体验局',
        'created_at': '2026-01-01T00:00:00Z', 'creator_id': 'visual-club-owner',
        'building_id': CLUB_IDENTIFIER, 'building_type': 'club', 'game_type': 'texas_holdem',
        'room_status': 'opening', 'timer_status': 'wait_for_timing',
        'remaining_seconds': 3600, 'booking_seconds': 3600, 'seat_occupied': 2,
        'options': {
            'club_id': CLUB_IDENTIFIER, 'club_name': CLUB_NAME,
            'game_version': {'type': 'texas_holdem', 'variant': 'normal',
                             'buildNumber': 1, 'engineType': 'react_native'},
        },
        'game_config': {'currency': 'coin', 'small_blind': 1, 'big_blind': 2,
                        'ante': 0, 'minimum_buy_in': 100, 'seat_quantity': 9,
                        'variation': 'texas_holdem'},
    },
    {
        'room_id': 'visual-club-room-two', 'room_name': '周末牌局',
        'created_at': '2026-01-01T00:00:00Z', 'creator_id': 'visual-club-owner',
        'building_id': CLUB_IDENTIFIER, 'building_type': 'club', 'game_type': 'texas_holdem',
        'room_status': 'opening', 'timer_status': 'wait_for_timing',
        'remaining_seconds': 3600, 'booking_seconds': 3600, 'seat_occupied': 4,
        'options': {
            'club_id': CLUB_IDENTIFIER, 'club_name': CLUB_NAME,
            'game_version': {'type': 'texas_holdem', 'variant': 'normal',
                             'buildNumber': 1, 'engineType': 'react_native'},
        },
        'game_config': {'currency': 'coin', 'small_blind': 2, 'big_blind': 4,
                        'ante': 0, 'minimum_buy_in': 200, 'seat_quantity': 9,
                        'variation': 'texas_holdem'},
    },
]


class ClubRoomVisualProxy(ProxyHTTP):
    """只在专用场景中匹配指定俱乐部及其房间，其他请求保持原路径。"""

    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.club_room_requests = {}

    def status(self):
        """提供代理启动探测及业务响应计数，供截图断言确认流量来源。"""
        return {
            'scenario': self.scenario,
            'interceptedRequests': sum(self.club_room_requests.values()),
            'proxiedRequests': self.proxied_requests,
            'stabilizedRequests': self.stabilized_requests,
            'clubRoomRequests': self.club_room_requests,
        }

    def control(self, flow):
        """只接受带本轮随机令牌的场景控制与状态查询。"""
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            flow.response = http.Response.make(403, b'{}')
            return
        path = urlsplit(flow.request.path).path
        if self.control_command(flow, path):
            respond(flow, self.status())

    def control_command(self, flow, path):
        if (flow.request.method, path) == ('POST', '/scenario'):
            return self.configure_scenario(flow)
        if (flow.request.method, path) != ('GET', '/status'):
            flow.response = http.Response.make(400, b'{}')
            return False
        return True

    def configure_scenario(self, flow):
        scenario = self.read_scenario(flow)
        if scenario not in (None, 'visual-stable'):
            flow.response = http.Response.make(400, b'{}')
            return False
        self.scenario = scenario
        self.club_room_requests = {}
        return True

    def read_scenario(self, flow):
        try:
            return json.loads(flow.request.content)['scenario']
        except (ValueError, KeyError, TypeError):
            return False

    def fixture(self, flow):
        """校验方法、目标俱乐部及正文；其他请求透传。"""
        url = urlsplit(flow.request.path)
        if (flow.request.method, url.path) == ('GET', '/v10/club'):
            return self.club_list(url)
        if flow.request.method == 'PUT':
            return self.put_fixture(flow, url.path)
        return None

    def club_list(self, url):
        return {'clubs': [{'id': CLUB_IDENTIFIER}]} if parse_qs(url.query).get('user_id') else None

    def put_fixture(self, flow, path):
        try:
            body = json.loads(flow.request.content)
        except (ValueError, TypeError):
            return None
        return self.club_fixture(path, body)

    def club_fixture(self, path, body):
        if path == '/v10/clubs' and body.get('club_ids') == [CLUB_IDENTIFIER]:
            return self.club_details()
        return self.room_fixture(path, body)

    def room_fixture(self, path, body):
        if path == '/v2/building/rooms' and body.get('building_ids') == [CLUB_IDENTIFIER]:
            return CLUB_ROOMS
        return None

    def club_details(self):
        return [{
            'id': CLUB_IDENTIFIER, 'club_id': CLUB_IDENTIFIER, 'club_no': 151,
            'name': CLUB_NAME, 'owner': {'id': 'visual-club-owner', 'role': 'owner'},
            'owner_id': 'visual-club-owner', 'admin_ids': [],
            'create_room_role': ['owner'], 'room_amount': 2,
        }]

    def fixture_request(self, flow):
        result = self.fixture(flow)
        if result is None:
            return
        path = urlsplit(flow.request.path).path
        self.club_room_requests[path] = self.club_room_requests.get(path, 0) + 1
        respond(flow, {'ok': True, 'result': result})


addons = [ClubRoomVisualProxy()]
