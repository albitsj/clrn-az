"""只修改本次真实创建的房间显示配置，服务端仍保留私人房等待状态。"""

import json
from texas_replay import valid_uuid
from room_creation import creation_request, is_creation_request, successful_response, successful_result


class RoomView:
    def __init__(self):
        self.mode = None
        self.room_id = None
        self.self_id = None

    def configure(self, mode):
        if mode not in (None, 'hall', 'record-v2', 'guest'):
            raise ValueError('Unknown room view')
        self.mode, self.room_id, self.self_id = mode, None, None

    def response(self, flow, path):
        if not self.mode or not successful_response(flow):
            return
        self.read_response(flow, path)

    def read_response(self, flow, path):
        try:
            body = json.loads(flow.response.content)
            self.update_response(flow, path, body)
        except (ValueError, TypeError, AttributeError):
            return

    def update_response(self, flow, path, body):
        result = successful_result(body)
        if result is None:
            return
        self.bind_creation(flow, path, result)
        if self.is_room_read(flow, path):
            self.update_room(flow, body, result)

    def bind_creation(self, flow, path, result):
        if self.room_id or not is_creation_request(flow, path):
            return
        self.bind_request(json.loads(flow.request.content), result)

    def bind_request(self, request, result):
        if not creation_request(request, ('texas_holdem', 'texas_react_native')):
            return
        self.bind_identifiers(request.get('user_id'), result.get('room_id'))

    def bind_identifiers(self, user_id, room_id):
        if valid_uuid(user_id) and valid_uuid(room_id):
            self.room_id, self.self_id = room_id, user_id

    def is_room_read(self, flow, path):
        if not self.room_id:
            return False
        return flow.request.method == 'GET' and path == f'/v1/room/{self.room_id}'

    def update_room(self, flow, body, result):
        updates = {'hall': self.hall_room, 'guest': self.guest_room}
        if self.mode in updates:
            updates[self.mode](result)
            flow.response.content = json.dumps(body).encode()

    def hall_room(self, result):
        result['building_type'] = 'hall'
        result.setdefault('game_config', {})['prediction_currency'] = 'coin'
        result['game_config']['currency'] = 'coin'

    def guest_room(self, result):
        result['creator_id'] = '00000000-0000-4000-8000-000000000001'
        result['admin_ids'] = []

    def fixture(self, path, method, self_id, content=b''):
        if self.mode != 'hall' or not self.room_id:
            return None
        return self.hall_fixture(path, method)

    def hall_fixture(self, path, method):
        routes = {
            ('PUT', f'/v10/texas_holdem/room/{self.room_id}/user_settings'): {'auto_rebuy': False},
            ('GET', f'/v10/texas_holdem/room/{self.room_id}/hand_prediction/rule'): {
                'rules': [{'prediction_type': 'pair', 'name': 'Pair', 'multiplier': 2,
                           'currency_name': 'coin', 'prediction_amount_range': [10, 20],
                           'default_prediction_amount': 10}]},
        }
        return routes.get((method, path))
