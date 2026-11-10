"""Account-bound record routes and small fixture response builders."""

from data import CLUB, HOUSE, PLAYER, all_records, detail, records, replay, rooms, round_data, settlements


def session_ids():
    return {record['play_session_id'] for record in all_records()}


def game_amount(room_id):
    return 0 if room_id.endswith('empty') else 3


def game_ids():
    return {f'{session}-game-{index}' for session in session_ids() for index in range(1, 4)}


def replay_game(user, game_id):
    return replay(user, int(game_id.rsplit('-', 1)[-1]), game_id.rsplit('-game-', 1)[0])


class RecordFixtures:
    def fixture(self, path, method, body, query):
        if not self.user_id:
            return None
        if self.is_delete(path, method):
            return self.delete_record(path)
        return self.route_fixture(path, method, body, query)

    def is_delete(self, path, method):
        return path.startswith(f'/v1/game_log/user/{self.user_id}/room/') and method == 'DELETE'

    def delete_record(self, path):
        room_id = path.rsplit('/', 1)[-1]
        if room_id not in session_ids():
            return None
        if self.mode != 'delete-error':
            self.deleted.append(room_id)
        return {}

    def route_fixture(self, path, method, body, query):
        route = self.fixture_routes().get((method, path))
        if route is None:
            return None
        handler, args = route
        return handler(body, query, *args)

    def fixture_routes(self):
        user = self.user_id
        routes = {
            ('GET', f'/v10/texas_holdem/user/{user}/game_records'): (self.legacy_list, ()),
            ('PUT', f'/v11/game_log/{user}/play_session_record/recent'): (self.recent_records, ()),
            ('PUT', '/v1/room'): (self.room_batch, ()),
            ('PUT', '/v1/game_log/room/settlement'): (self.settlement_batch, ()),
            ('PUT', '/v11/game_log/room/settlement'): (self.settlement_batch, ()),
            ('PUT', f'/v1/game_log/user/{user}/rooms/settlement'): (self.user_settlements, ()),
            ('GET', '/v10/club'): (self.club_list, ()),
            ('PUT', '/v10/clubs'): (self.club_details, ()),
            ('PUT', '/v10/profile/users'): (self.profile_batch, ()),
            ('PUT', '/v1/game_log/room/game_amount'): (self.amount_batch, ()),
            ('PUT', f'/v1/game_log/user/{user}/games'): (self.replay_batch, ()),
        }
        for room_id in session_ids():
            routes.update(self.session_routes(room_id))
        return routes

    def session_routes(self, room_id):
        prefix = f'/v11/game_log/{self.user_id}'
        return {
            ('GET', f'{prefix}/play_session_record/{room_id}'): (self.session_detail, (room_id,)),
            ('GET', f'{prefix}/round/{room_id}'): (self.session_round, (room_id,)),
            ('GET', f'{prefix}/round/{room_id}-round'): (self.session_round, (room_id,)),
            ('GET', f'/v1/room/{room_id}'): (self.room_detail, (room_id,)),
            ('GET', f'/v1/game_log/room/{room_id}/game_amount'): (self.session_amount, (room_id,)),
            ('PUT', f'/v1/game_log/room/{room_id}/game'): (self.session_games, (room_id,)),
            ('GET', f'/v1/game_log/room/{room_id}/settlement'): (self.session_settlements, (room_id,)),
        }

    def visible_records(self):
        source = self.record_source()
        return [record for record in source if self.visible_record(record)]

    def record_source(self):
        return all_records() if self.mode == 'paged' else records()

    def visible_record(self, record):
        if record['play_session_id'] in self.deleted:
            return False
        return self.mode != 'no-hands' or record['all_round_count'] == 0

    def selected_records(self):
        return [] if self.mode == 'empty' else self.visible_records()

    def legacy_list(self, body, query):
        selected, next_page = self.list_page(query)
        return {'next_page': next_page, 'items': [
            {'room_id': item['play_session_id'], 'create_at': item['create_at']} for item in selected]}

    def list_page(self, query):
        if self.mode != 'paged':
            return self.selected_records(), None
        data = self.visible_records()
        return (data[20:], None) if query.get('next_page') == ['visual-page-2'] else (data[:20], 'visual-page-2')

    def recent_records(self, body, query):
        if body.get('user_id') != self.user_id:
            return None
        return {'records': self.selected_records()}

    def session_detail(self, body, query, room_id):
        return detail(self.user_id, room_id)

    def session_round(self, body, query, room_id):
        return round_data(self.user_id, room_id)

    def room_batch(self, body, query):
        if not set(body.get('rooms', [])) <= session_ids():
            return None
        return {room_id: rooms()[room_id] for room_id in body['rooms']}

    def room_detail(self, body, query, room_id):
        room = rooms()[room_id]
        if room_id.endswith('private'):
            room.update(room_status='open', timer_status='timing', remaining_seconds=3600)
        return room

    def settlement_batch(self, body, query):
        requested = body.get('room_ids', [])
        if not set(requested) <= session_ids():
            return None
        return {'rooms_settlements': {room_id: settlements(self.user_id, room_id) for room_id in requested}}

    def user_settlements(self, body, query):
        requested = body.get('room_ids', [])
        if not set(requested) <= session_ids():
            return None
        return {'rooms_settlement': self.settlement_rows(requested)}

    def settlement_rows(self, requested):
        return [dict(settlements(self.user_id, room_id)[0], room_id=room_id)
                for room_id in requested if settlements(self.user_id, room_id)]

    def club_list(self, body, query):
        if query.get('user_id') == [self.user_id]:
            return {'clubs': [{'id': CLUB, 'club_id': CLUB, 'name': 'Visual Club', 'room_amount': 0}]}
        return None

    def club_details(self, body, query):
        if body.get('club_ids') == [CLUB]:
            return [{'club_id': CLUB, 'name': 'Visual Club', 'avatar': '', 'room_amount': 0}]
        return None

    def profile_batch(self, body, query):
        if not set(body.get('users', [])) <= {PLAYER, HOUSE}:
            return None
        return {player: {'user_id': player, 'nickname': 'Opponent', 'avatarPath': ''} for player in body['users']}

    def session_amount(self, body, query, room_id):
        return {'game_amount': game_amount(room_id)}

    def session_games(self, body, query, room_id):
        if room_id.endswith('empty'):
            return {'results': []}
        return {'results': [{'game_id': f'{room_id}-game-{index}', 'game_number': index}
                            for index in body['game_numbers']]}

    def session_settlements(self, body, query, room_id):
        return {'settlements': settlements(self.user_id, room_id)}

    def amount_batch(self, body, query):
        if not set(body.get('room_ids', [])) <= session_ids():
            return None
        return {'results': [{'room_id': room_id, 'game_amount': game_amount(room_id)} for room_id in body['room_ids']]}

    def replay_batch(self, body, query):
        requested = body.get('game_ids', [])
        if not set(requested) <= game_ids():
            return None
        return {'results': [replay_game(self.user_id, game_id) for game_id in requested]}
