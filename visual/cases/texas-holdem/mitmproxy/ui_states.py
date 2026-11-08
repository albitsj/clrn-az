"""本轮回放房间的视觉分支夹具，不改真实玩家、申请或钱包。"""

from urllib.parse import urlsplit, parse_qs
from texas_replay import PLAYER_IDS


class UIStates:
    def __init__(self):
        self.release()

    def release(self):
        self.applications = None
        self.rpc_error = None

    def configure(self, options):
        if not isinstance(options, dict) or set(options) - {'applications', 'rpcError'}:
            raise ValueError('Invalid UI options')
        self.validate_states(options)
        self.applications = options.get('applications')
        self.rpc_error = options.get('rpcError')

    def validate_states(self, options):
        if options.get('applications') not in (None, 'pending', 'resolved', 'more') or (
                options.get('rpcError') not in (None, 'retry', 'balance', 'auth')):
            raise ValueError('Invalid UI state')

    def rpc_result(self, frame):
        path = frame['params']['data']['path']
        if not self.rpc_error or not self.is_error_operation(path):
            return None
        return self.error_result()

    def is_error_operation(self, path):
        return path.endswith('/call') or path == '/v3/pay_action/do'

    def error_result(self):
        errors = {
            'auth': {'ok': False, 'message': 'Access Token Not Found'},
            'balance': {'ok': False, 'error': 'insufficient_balance', 'error_description': 'Insufficient balance'},
        }
        return errors.get(self.rpc_error, {
            'ok': False, 'error': 'visual_network_failure', 'error_description': 'Please retry'})

    def fixture(self, url, method, content, room_id):
        if not room_id:
            return None
        parsed = urlsplit(url)
        mutation = self.mutation_fixture(parsed.path, method, room_id)
        if mutation is not None:
            return mutation
        return self.read_fixture(parsed, method, room_id)

    def mutation_fixture(self, path, method, room_id):
        settings = f'/v10/texas_holdem/room/{room_id}/user_settings'
        mutations = {
            ('PUT', settings + '/enable_auto_rebuy'): {'auto_rebuy': True},
            ('PUT', settings + '/disable_auto_rebuy'): {'auto_rebuy': False},
            ('PUT', f'/v10/texas_holdem/room/{room_id}/hand_prediction'): {},
            ('DELETE', f'/v10/texas_holdem/room/{room_id}/hand_prediction'): {},
        }
        return mutations.get((method, path))

    def read_fixture(self, parsed, method, room_id):
        if (method, parsed.path) != ('GET', f'/v11/buy_in/{room_id}/applications'):
            return None
        if not self.applications:
            return None
        return self.application_page(parse_qs(parsed.query).get('next_page', [''])[0])

    def application_page(self, next_page):
        if next_page not in ('', 'visual-next'):
            return None
        return {'applications': self.application_rows(next_page), 'next_page': self.next_page(next_page)}

    def application_rows(self, next_page):
        statuses = self.statuses(next_page)
        offset = 3 if next_page else 0
        return [self.application_row(index, status, offset) for index, status in enumerate(statuses)]

    def statuses(self, next_page):
        if next_page:
            return ['approve']
        return ['approve', 'reject', 'overdue'] if self.applications == 'resolved' else [None, None]

    def application_row(self, index, status, offset):
        return {'application_id': f'visual-application-{index + offset}',
                'user_id': PLAYER_IDS[index], 'nickname': f'Player{index + 1}',
                'amount': 500 + index * 100, 'room_name': 'TestRoom', 'status': status}

    def next_page(self, current):
        return 'visual-next' if self.applications == 'more' and not current else ''
