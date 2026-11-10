"""拼三张独立代理：真实选线，只回放本例真实创建的私人房。"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from zhajinhua_replay import PLAYER_IDS, ZhajinhuaReplay

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '_shared' / 'mitmproxy'))
from proxy_control import ProxyControl  # noqa: E402
from proxy_http import respond, is_staging, prepare_profiles, patch_profiles  # noqa: E402
from replay_protocol import valid_uuid  # noqa: E402
from room_creation import creation_request, is_creation_request, successful_response  # noqa: E402

CONTROL_HOST = 'test-mitmproxy.invalid'


class ZhajinhuaVisualProxy(ProxyControl):
    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.created_room_id = None
        self.replay = ZhajinhuaReplay()

    invalid_command = 'Invalid replay command'
    release_path = '/zhajinhua/release'

    def status(self):
        return {**self.traffic_status(),
                'replayedMessages': self.replay.replayed_messages, 'blockedRpcs': self.replay.blocked_rpcs}

    def commands(self):
        return {'/zhajinhua/replay': self.publish_replay,
                '/zhajinhua/operation-reward': self.configure_reward}

    def reset_scenario(self):
        self.release_command({})

    def release_command(self, body):
        self.replay.release()
        self.created_room_id = None

    def publish_replay(self, body):
        if not self.created_room_id or body.get('roomId') != self.created_room_id:
            raise ValueError('Replay requires this test room')
        self.replay.publish(body['roomId'], scene=body['scene'])

    def configure_reward(self, body):
        self.replay.set_operation_reward(body.get('roomId'), body.get('enabled'))

    def response(self, flow):
        if not self.active(flow):
            return
        path = urlsplit(flow.request.path).path
        self.patch_profiles(flow, path)
        self.bind_creation(flow, path)

    def replay_profiles(self):
        return {player: self.replay.profile(player) for player in PLAYER_IDS}

    def patch_profiles(self, flow, path):
        if self.replay.room_id and path == '/v10/profile/users':
            self.stabilized_requests += patch_profiles(flow, self.replay.self_id,
                self.replay_profiles())

    def bind_creation(self, flow, path):
        if self.created_room_id:
            return
        self.bind_creation_response(flow, path)

    def bind_creation_response(self, flow, path):
        if not is_creation_request(flow, path):
            return
        if successful_response(flow):
            self.read_creation(flow)

    def read_creation(self, flow):
        try:
            self.bind_room(json.loads(flow.request.content), json.loads(flow.response.content))
        except (ValueError, TypeError, AttributeError):
            return

    def bind_room(self, request, body):
        room_id = body.get('result', {}).get('room_id')
        if not creation_request(request, ('zhajinhua',)):
            return
        self.bind_identifier(body, room_id)

    def bind_identifier(self, body, room_id):
        if body.get('ok') is True and valid_uuid(room_id):
            self.created_room_id = room_id

    def websocket_message(self, flow):
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.replay.websocket_message(flow)

    def websocket_end(self, flow):
        self.replay.websocket_end(flow)

    def prepare_profiles(self, flow):
        return self.replay.room_id and prepare_profiles(flow, self.replay.self_id, PLAYER_IDS)

    def fixture_request(self, flow):
        if self.prepare_profiles(flow):
            return
        path = urlsplit(flow.request.path).path
        if self.is_profile_read(flow.request.method, path):
            self.read_fixture(flow, path)

    def is_profile_read(self, method, path):
        return method == 'GET' or (method, path) == ('PUT', '/v10/profile/users')

    def read_fixture(self, flow, path):
        try:
            fixture = self.replay.http_fixture(path, flow.request.content)
        except (ValueError, TypeError, AttributeError):
            return
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1


addons = [ZhajinhuaVisualProxy()]
