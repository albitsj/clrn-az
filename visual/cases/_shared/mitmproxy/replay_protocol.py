"""Centrifuge replay transport shared by the isolated visual fixtures."""

import json
import re

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'


def valid_uuid(value):
    return isinstance(value, str) and re.fullmatch(UUID, value, re.I)


def object_value(value):
    return value if isinstance(value, dict) else {}


def publication(frame, kind):
    if 'id' in frame:
        return None
    result = frame.get('result')
    if not isinstance(result, dict):
        return None
    return publication_kind(result, kind)


def publication_kind(result, kind):
    return result if result.get('type', 0) == kind else None


def channel_value(params):
    channel = params.get('channel')
    return channel if isinstance(channel, str) else None


def positive_command(frame):
    command = frame.get('id')
    return isinstance(command, int) and command > 0


def successful_subscription(frame):
    return 'error' not in frame and isinstance(frame.get('result'), dict)


def rpc_data(frame):
    if frame.get('method') != 9:
        return None
    data = object_value(frame.get('params')).get('data')
    if not isinstance(data, dict):
        return None
    return path_data(data)


def path_data(data):
    return data if isinstance(data.get('path'), str) else None


def encode_frames(frames):
    return '\n'.join(json.dumps(frame) for frame in frames).encode()


def replace_frames(message, frames):
    message.content = encode_frames(frames)
    if not frames:
        message.drop()


def parse_frames(message):
    try:
        frames = decode_lines(message.text)
    except (ValueError, TypeError):
        return None
    return frames


def decode_lines(text):
    return [json.loads(line) for line in text.splitlines() if line]


def dictionary_frames(frames):
    return all(isinstance(frame, dict) for frame in frames)


class ReplayProtocol:
    def __init__(self):
        self.subscriptions = {}
        self.pending_subscriptions = {}
        self.room_id = None
        self.replayed_messages = 0
        self.self_id = None

    def validate_replay(self, room_id, data, scene):
        if not valid_uuid(room_id):
            raise ValueError('Invalid replay')
        self.validate_payload(data, scene)
        self.validate_owner(room_id)

    def validate_payload(self, data, scene):
        if scene is None and not isinstance(data, dict):
            raise ValueError('Invalid replay')

    def validate_owner(self, room_id):
        if self.room_id and room_id != self.room_id:
            raise ValueError('Another room already owns this replay')

    def target_channels(self, room_id, channels):
        return [channel for channel in channels
                if re.fullmatch(rf'{self.game}>{room_id}#{UUID}', channel, re.I)]

    def flow_targets(self, room_id, flow, channels):
        if flow.websocket.timestamp_end is not None:
            return []
        return [(flow, channel) for channel in self.target_channels(room_id, channels)]

    def targets(self, room_id):
        targets = []
        for flow, channels in self.subscriptions.values():
            targets.extend(self.flow_targets(room_id, flow, channels))
        return targets

    def publish(self, room_id, data=None, *, scene=None):
        self.validate_replay(room_id, data, scene)
        targets = self.targets(room_id)
        if not targets:
            raise ValueError(self.no_subscription)
        self_id = targets[0][1].rsplit('#', 1)[-1]
        data = self.scene_data(self_id, data, scene)
        self.room_id, self.self_id = room_id, self_id
        self.publish_targets(targets, data)

    def scene_data(self, self_id, data, scene):
        if scene is not None:
            from replay_scenes import replay_scene
            return replay_scene(self.scene_game, self_id, scene)
        return data

    def publish_targets(self, targets, data):
        # Centrifuge v2 publication: no id, type=0.
        for flow, channel in targets:
            payload = {'result': {'type': 0, 'channel': channel, 'data': {'data': data}}}
            self.inject(flow, json.dumps(payload).encode())
            self.replayed_messages += 1

    def is_replay_publication(self, frame):
        result = publication(frame, 0)
        if result is None:
            return False
        channel = channel_value(result)
        return self.is_room_channel(channel) if channel is not None else False

    def is_room_channel(self, channel):
        return re.fullmatch(rf'{self.game}>{self.room_id}#{UUID}', channel, re.I) is not None

    def websocket_message(self, flow):
        message = flow.websocket.messages[-1]
        if not message.is_text or message.injected:
            return
        self.process_message(flow, message)

    def process_message(self, flow, message):
        frames = parse_frames(message)
        if frames is None:
            return
        if dictionary_frames(frames):
            self.process_frames(flow, message, frames)

    def process_frames(self, flow, message, frames):
        channels = self.subscriptions.setdefault(flow.id, (flow, set()))[1]
        pending = self.pending_subscriptions.setdefault(flow.id, {})
        if message.from_client:
            self.client_frames(flow, message, frames, channels, pending)
        else:
            self.server_frames(message, frames, channels, pending)

    def client_frames(self, flow, message, frames, channels, pending):
        for frame in frames:
            self.client_subscription(frame, channels, pending)
        self.block_rpcs(flow, message, frames, channels)

    def client_subscription(self, frame, channels, pending):
        params = object_value(frame.get('params'))
        if not params:
            return
        channel = channel_value(params)
        if channel is not None:
            self.subscription_command(frame, channel, channels, pending)

    def subscription_command(self, frame, channel, channels, pending):
        handlers = {1: self.subscribe, 2: self.unsubscribe}
        # Compare method values directly, including malformed unhashable values.
        for method, handler in handlers.items():
            if frame.get('method') == method:
                handler(frame, channel, channels, pending)

    def subscribe(self, frame, channel, channels, pending):
        if positive_command(frame):
            pending[frame['id']] = channel

    def unsubscribe(self, frame, channel, channels, pending):
        self.discard_channel(channel, channels, pending)

    def discard_channel(self, channel, channels, pending):
        channels.discard(channel)
        commands = self.pending_commands(channel, pending)
        for command in commands:
            pending.pop(command)

    def pending_commands(self, channel, pending):
        return [command for command, target in pending.items() if target == channel]

    def blocked_frames(self, frames, channels):
        if not self.target_flow(channels):
            return []
        return self.replay_rpcs(frames)

    def replay_rpcs(self, frames):
        return [frame for frame in frames if self.is_replay_rpc(frame)]

    def block_rpcs(self, flow, message, frames, channels):
        blocked = self.blocked_frames(frames, channels)
        if not blocked:
            return
        self.count_blocked(blocked)
        replace_frames(message, self.unblocked_frames(frames, blocked))
        self.reply_rpcs(flow, blocked)

    def unblocked_frames(self, frames, blocked):
        return [frame for frame in frames if frame not in blocked]

    def count_blocked(self, blocked):
        pass

    def reply_rpcs(self, flow, blocked):
        replies = self.rpc_replies(blocked)
        if replies:
            self.inject(flow, encode_frames(replies))

    def rpc_replies(self, blocked):
        return [self.rpc_reply(frame) for frame in blocked if 'id' in frame]

    def rpc_reply(self, frame):
        return {'id': frame['id'], 'result': {'data': self.rpc_result(frame)}}

    def server_frames(self, message, frames, channels, pending):
        for frame in frames:
            self.confirm_subscription(frame, channels, pending)
            self.server_unsubscribe(frame, channels, pending)
        self.filter_publications(message, frames)

    def confirm_subscription(self, frame, channels, pending):
        command = frame.get('id') if isinstance(frame.get('id'), int) else None
        if command in pending:
            channel = pending.pop(command)
            self.confirm_channel(frame, channel, channels)

    def confirm_channel(self, frame, channel, channels):
        if successful_subscription(frame):
            channels.add(channel)
        else:
            channels.discard(channel)

    def server_unsubscribe(self, frame, channels, pending):
        result = publication(frame, 3)
        if result is None:
            return
        channel = channel_value(result)
        if channel is not None:
            self.discard_channel(channel, channels, pending)

    def filter_publications(self, message, frames):
        if self.room_id:
            replace_frames(message, self.non_publications(frames))

    def non_publications(self, frames):
        return [frame for frame in frames if not self.is_replay_publication(frame)]

    def websocket_end(self, flow):
        self.subscriptions.pop(flow.id, None)
        self.pending_subscriptions.pop(flow.id, None)

    def room_rpc(self, path):
        return any(re.match(pattern, path) for pattern in (
            rf'/v\d+/{self.game}/room/{self.room_id}(?:/|$)',
            rf'/v1/chat_room/{self.room_id}(?:/|$)'))

    def chat_result(self, path):
        return {'ok': True, 'result': {
            'users': [self.self_id] if self.self_id else [], 'user_id': self.self_id,
            'can_audio': True, 'can_video': True, 'has_joined': path.endswith('/join')}}

    def profile(self, player_id):
        return {'user_id': player_id, 'nickname': self.nickname(player_id), 'avatar_path': '',
                'gender': 'male', 'bio': 'TestPlayer',
                'user_level': {'App:coin': {'level': 5, 'progress': 0.5}}, 'last_used_nickname': ''}

    def nickname(self, player_id):
        return 'TestPlayer' if player_id == self.self_id else f'Player{self.player_ids.index(player_id) + 1}'

    def http_fixture(self, path, body=b''):
        if not self.room_id:
            return None
        if path == '/v10/profile/users':
            return self.profiles(json.loads(body).get('users', []))
        return self.player_fixture(path)

    def profiles(self, requested):
        if not requested:
            return None
        return self.known_profiles(requested)

    def known_profiles(self, requested):
        if self.known_players(requested):
            return {identifier: self.profile(identifier) for identifier in requested}
        return None

    def known_players(self, requested):
        return all(identifier in self.player_ids for identifier in requested)

    def path_player(self, path):
        return next((identifier for identifier in self.player_ids if identifier in path), None)

    def player_fixture(self, path):
        player_id = self.path_player(path)
        if player_id:
            return self.profile_fixture(path, player_id)
        return None

    def profile_fixture(self, path, player_id):
        if re.fullmatch(rf'/v10/profile/{UUID}', path):
            return self.profile(player_id)
        if re.fullmatch(rf'/v10/wallet/{UUID}/currency/coin', path):
            return {'balance': 12345}
        return self.statistics_fixture(path)

    def statistics_fixture(self, path):
        return None
