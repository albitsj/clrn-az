"""Game policies layered over the shared Centrifuge replay transport."""

import re
from mitmproxy import ctx
from replay_protocol import ReplayProtocol, UUID as UUID, object_value, rpc_data, valid_uuid as valid_uuid

TEXAS_PLAYER_IDS = [f"00000000-0000-4000-8000-{index:012d}" for index in range(1, 5)]
TABLE_PLAYER_IDS = [f"00000000-0000-4000-8000-{index:012d}" for index in range(1, 9)]


class TexasReplay(ReplayProtocol):
    game = 'texas_holdem'
    scene_game = 'texas'
    no_subscription = 'No subscribed Texas room'
    player_ids = TABLE_PLAYER_IDS

    def __init__(self):
        super().__init__()
        self.created_room_id = None
        self.ui_states = None

    def inject(self, flow, payload):
        ctx.master.commands.call('inject.websocket', flow, True, payload, True)

    def arm_created_room(self, room_id, self_id):
        self.room_id = self.created_room_id = room_id
        self.self_id = self_id

    def release(self):
        self.room_id = None
        self.self_id = None
        self.created_room_id = None
        self.ui_states = None

    def target_flow(self, channels):
        if not self.room_id:
            return False
        return self.created_room_id == self.room_id or self.subscribed_room(channels)

    def subscribed_room(self, channels):
        return any(channel.startswith(f'texas_holdem>{self.room_id}#') for channel in channels)

    def is_replay_rpc(self, frame):
        data = rpc_data(frame)
        if data is None:
            return False
        return self.blockable_rpc(data)

    def blockable_rpc(self, data):
        # Keep the real room heartbeat alive during long animation sampling.
        if self.is_heartbeat(data):
            return False
        return self.room_rpc(data['path']) or self.payment_rpc(data)

    def is_heartbeat(self, data):
        return data.get('method') == 'POST' and re.fullmatch(
            rf'/v\d+/texas_holdem/room/{self.room_id}/player/alive', data['path'])

    def payment_rpc(self, data):
        if data['path'] != '/v3/pay_action/do' or data.get('method') != 'POST':
            return False
        action = object_value(object_value(data.get('json')).get('action_url'))
        return self.allowed_payment(action)

    def allowed_payment(self, action):
        allowed = (
            ('PUT', '/v10/texas_holdem/room/$room_id$/game/$game_id$/check_community_card'),
            ('POST', '/v10/texas_holdem/room/$room_id$/game/$game_id$/operating_time'),
        )
        return action.get('room_id') == self.room_id and (action.get('method'), action.get('path')) in allowed

    def rpc_result(self, frame):
        error = self.ui_states.rpc_result(frame) if self.ui_states else None
        if error is not None:
            return error
        return self.success_result(frame['params']['data']['path'])

    def success_result(self, path):
        if path.startswith(f'/v1/chat_room/{self.room_id}/'):
            return self.chat_result(path)
        return self.operation_result(path)

    def operation_result(self, path):
        # Payment fixtures never charge diamonds; preserve experience/level protocol.
        props = {'add_level_experience': 12}
        if path.endswith('/call'):
            props['level_up'] = {'new_level': 6}
        return {'ok': True, 'result': {**props, 'community_card': ['ah', 'kd', '7c', '2s', 'qs']}}

    def statistics_fixture(self, path):
        if re.fullmatch(rf'/v1/texas_statistics/player/{UUID}/rounds/(100|1000)', path):
            return {'total_hands': int(path.rsplit('/', 1)[-1]), 'vpip': 0.25, 'pfr': 0.18,
                    'af': 2.5, 'c_bet': 0.6, 'fold_to_c_bet': 0.4, 'fold_to_steal': 0.5,
                    'fold_to_three_bet': 0.5, 'steal': 0.3, 'three_bet': 0.08,
                    'win_rate': 0.2, 'win_rate_vp': 0.3, 'win_rate_wtsd': 0.5, 'wtsd': 0.3}
        return None


ZHAJINHUA_PLAYER_IDS = [f"00000000-0000-4000-8000-{index:012d}" for index in range(1, 5)]


class ZhajinhuaReplay(ReplayProtocol):
    game = scene_game = 'zhajinhua'
    no_subscription = 'No subscribed Zhajinhua room'
    player_ids = ZHAJINHUA_PLAYER_IDS

    def __init__(self):
        super().__init__()
        self.blocked_rpcs = 0
        self.operation_reward = False

    def inject(self, flow, payload):
        ctx.master.commands.call('inject.websocket', flow, True, payload, True)

    def release(self):
        self.room_id = None
        self.self_id = None
        self.operation_reward = False

    def set_operation_reward(self, room_id, enabled):
        if not self.room_id:
            raise ValueError('Operation reward requires the bound replay room')
        self.validate_reward(room_id, enabled)
        self.operation_reward = enabled

    def validate_reward(self, room_id, enabled):
        if room_id != self.room_id or not isinstance(enabled, bool):
            raise ValueError('Operation reward requires the bound replay room')

    def is_room_channel(self, channel):
        return channel == f'zhajinhua|{self.room_id}' or super().is_room_channel(channel)

    def target_flow(self, channels):
        # RPC may use another connection in the pool; ownership is the room UUID.
        return self.room_id

    def count_blocked(self, blocked):
        self.blocked_rpcs += len(blocked)

    def is_replay_rpc(self, frame):
        data = rpc_data(frame)
        return self.room_rpc(data['path']) if data is not None else False

    def rpc_result(self, frame):
        path = frame['params']['data']['path']
        if self.rewarded_operation(path):
            return {'ok': True, 'result': {
                'add_level_experience': 25, 'level_up': {'new_level': 6}}}
        return self.success_result(path)

    def rewarded_operation(self, path):
        return self.operation_reward and re.fullmatch(
            rf'/v\d+/zhajinhua/room/{self.room_id}/game/[^/]+/(call|raise|all_in|challenge)', path)

    def success_result(self, path):
        if path.startswith(f'/v1/chat_room/{self.room_id}/'):
            return self.chat_result(path)
        return {'ok': True, 'result': {}}
