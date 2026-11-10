"""德州视觉测试专用代理；App 和其他玩法不会加载此脚本。"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from texas_replay import PLAYER_IDS, TABLE_PLAYER_IDS, TexasReplay
from room_view import RoomView
from game_log import fixture as log_fixture
from records_v2 import RecordsV2
from ui_states import UIStates

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '_shared' / 'mitmproxy'))
from proxy_control import ProxyControl  # noqa: E402
from proxy_http import respond, is_staging, prepare_profiles, patch_profiles, patch_version  # noqa: E402

CONTROL_HOST = 'test-mitmproxy.invalid'
INVALID_FIXTURE = object()


class TexasVisualProxy(ProxyControl):
    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.texas = TexasReplay()
        self.view = RoomView()
        self.records = RecordsV2()
        self.ui = UIStates()

    invalid_command = 'Invalid replay command'
    release_path = '/texas/release'

    def status(self):
        return {**self.traffic_status(),
                'replayedMessages': self.texas.replayed_messages}

    def commands(self):
        return {'/texas/view': self.configure_view, '/texas/replay': self.publish_replay,
                '/texas/records': self.configure_records, '/texas/ui': self.configure_ui}

    def reset_scenario(self):
        self.release_command({})

    def release_command(self, body):
        self.texas.release()
        self.view.configure(None)
        self.records.release()
        self.ui.release()

    def configure_view(self, body):
        self.view.configure(body.get('mode'))

    def publish_replay(self, body):
        self.texas.publish(body.get('roomId'), scene=body['scene'])

    def configure_records(self, body):
        self.records.configure(body.get('empty'))
        if self.view.mode != 'record-v2':
            self.view.configure('record-v2')

    def configure_ui(self, body):
        if not self.texas.room_id:
            raise ValueError('Unknown command')
        self.ui.configure(body)
        self.texas.ui_states = self.ui

    def websocket_message(self, flow):
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.texas.websocket_message(flow)

    def websocket_end(self, flow):
        self.texas.websocket_end(flow)

    def response(self, flow):
        if not self.active(flow):
            return
        path = urlsplit(flow.request.path).path
        self.patch_profiles(flow, path)
        self.patch_version(flow, path)
        self.view.response(flow, path)
        self.record_response(flow, path)
        self.bind_view()

    def replay_profiles(self):
        return {player: self.texas.profile(player) for player in TABLE_PLAYER_IDS}

    def patch_profiles(self, flow, path):
        if self.texas.room_id and path == '/v10/profile/users':
            self.stabilized_requests += patch_profiles(flow, self.texas.self_id,
                self.replay_profiles())

    def patch_version(self, flow, path):
        if self.records.enabled and (flow.request.method, path) == ('GET', '/public/v11/game_log/available.json'):
            self.stabilized_requests += patch_version(flow, 'v11')

    def record_response(self, flow, path):
        try:
            self.records.response(flow, path, self.view.room_id)
        except (ValueError, TypeError, AttributeError):
            pass

    def bind_view(self):
        if self.view.room_id and not self.texas.room_id:
            # Isolate automatic seating as soon as the real creation response arrives.
            self.texas.arm_created_room(self.view.room_id, self.view.self_id)
        self.bind_self()

    def bind_self(self):
        if self.view.self_id and not self.texas.self_id:
            self.texas.self_id = self.view.self_id

    def prepare_profiles(self, flow):
        return self.texas.room_id and prepare_profiles(flow, self.texas.self_id, TABLE_PLAYER_IDS)

    def fixture_request(self, flow):
        if self.prepare_profiles(flow):
            return
        self.respond_fixture(flow)

    def respond_fixture(self, flow):
        fixture = self.request_fixture(flow)
        if fixture is INVALID_FIXTURE:
            return
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1

    def request_fixture(self, flow):
        # Evaluate in order. A malformed fixture request must stop the chain.
        for handler in (self.ui_fixture, self.records_fixture, self.view_fixture,
                        self.log_fixture, self.profile_fixture):
            fixture = handler(flow)
            if fixture is not None:
                return fixture
        return None

    def ui_fixture(self, flow):
        return self.guarded_fixture(self.read_ui, flow)

    def read_ui(self, flow):
        return self.ui.fixture(flow.request.path, flow.request.method, flow.request.content, self.texas.room_id)

    def records_fixture(self, flow):
        return self.records.fixture(urlsplit(flow.request.path).path, flow.request.method, self.texas.self_id)

    def view_fixture(self, flow):
        return self.guarded_fixture(self.read_view, flow)

    def read_view(self, flow):
        return self.view.fixture(urlsplit(flow.request.path).path, flow.request.method,
                                 self.texas.self_id, flow.request.content)

    def log_fixture(self, flow):
        return self.guarded_fixture(self.read_log, flow)

    def read_log(self, flow):
        return log_fixture(urlsplit(flow.request.path).path, flow.request.method, flow.request.content,
                           self.texas.room_id, self.texas.self_id)

    def is_blacklist(self, path, method):
        return path == '/v1/hall_matching/blacklist' and method in ('POST', 'DELETE')

    def profile_fixture(self, flow):
        return self.guarded_fixture(self.read_profile, flow)

    def guarded_fixture(self, handler, flow):
        try:
            return handler(flow)
        except (ValueError, TypeError, AttributeError):
            return INVALID_FIXTURE

    def read_profile(self, flow):
        path, method = urlsplit(flow.request.path).path, flow.request.method
        if self.texas.room_id and self.is_blacklist(path, method):
            return self.blacklist_fixture(flow)
        return self.profile_read(flow, path, method)

    def blacklist_fixture(self, flow):
        player_id = json.loads(flow.request.content).get('black_user_id')
        return {} if player_id in PLAYER_IDS else None

    def profile_read(self, flow, path, method):
        if method == 'GET' or (method, path) == ('PUT', '/v10/profile/users'):
            return self.texas.http_fixture(path, flow.request.content)
        return None


addons = [TexasVisualProxy()]
