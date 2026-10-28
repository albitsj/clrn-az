"""牌桌布局只在代理构造；测试端仅选择有限的展示分支。"""

from copy import deepcopy

PLAYERS = [f'00000000-0000-4000-8000-{i:012}' for i in range(1, 9)]
DEFAULT_BETS = {'fold': {}, 'call': {'amount': 20}, 'raise': {'minimum': 40, 'maximum': 1000},
                'all_in': {'amount': 1000}}
CHECK_BETS = {'fold': {}, 'check': {}, 'raise': {'minimum': 40, 'maximum': 1000}, 'all_in': {'amount': 1000}}
TABLES = ('standard', 'observer', 'full', 'full-pots', 'check', 'all-in-only', 'all-in-call',
          'shortcut-blinds', 'shortcut-disabled')
STREETS = {'preflop': 0, 'flop': 3, 'turn': 4, 'river': 5}


def flag(settings, name):
    value = settings.get(name, False)
    if not isinstance(value, bool):
        raise ValueError('Expected boolean scene parameter')
    return value


def texas_table(self_id, settings):
    street, table, part = settings.get('street', 'preflop'), settings.get('table', 'standard'), settings.get('part', 'all')
    if street not in STREETS or table not in TABLES or part not in ('all', 'without-hand', 'hand'):
        raise ValueError('Unknown table scene')
    opponent = flag(settings, 'opponent')
    observer, full = table == 'observer', table in ('full', 'full-pots')
    others = PLAYERS if full else PLAYERS[:4]
    players = others if observer else [self_id, *others]
    positions = ['BTN', 'SB', 'BB', 'UTG', 'MP1', 'MP2', 'MP3', 'HJ', 'CO'] if full else ['D', 'SB', 'BB', 'UTG', 'CO']
    bets = DEFAULT_BETS
    if table in ('check', 'shortcut-blinds'):
        bets = CHECK_BETS
    elif table == 'all-in-only':
        bets = {'fold': {}, 'all_in': {'amount': 15}}
    elif table == 'all-in-call':
        bets = {'fold': {}, 'call': {'amount': 15}, 'all_in': {'amount': 15}}
    elif table == 'shortcut-disabled':
        bets = {'fold': {}, 'call': {'amount': 20}, 'raise': {'minimum': 40, 'maximum': 50}, 'all_in': {'amount': 50}}
    pots = [6] if street == 'preflop' else [120, 60]
    if table == 'full-pots':
        pots = [90, 80, 70, 60, 50, 40, 30, 20, 10]
    elif table == 'shortcut-blinds':
        pots = [3]
    status = {
        'state': 'gaming', 'operating_seconds': 120, 'remain_seconds': 3600,
        'settings': {'small_blind': 1, 'big_blind': 2, 'ante': 0},
        'small_blind': 1, 'big_blind': 2, 'ante': 0, 'variation': 'texas_holdem',
        'game_variation': {}, 'pattern': 'tradition', 'number': 1, 'street': street,
        'community_card': ['ah', 'kd', '7c', '2s', 'qs'][:STREETS[street]], 'pots': pots,
        'seats': [{'number': i + 1, 'state': 'occupied' if i < len(players) else 'empty',
                   'position': positions[i] if i < len(positions) else '', 'reserve': {},
                   'player': {'player_id': players[i], 'seat_number': i + 1, 'stack': 1000 - i * 40,
                              'buy_in': 1000, 'is_leave': False, 'is_playing': True, 'position': positions[i],
                              'last_action': {'name': 'fold' if i == 3 else 'call', 'amount': 20},
                              'public_hole_card': [], 'hole_card': []} if i < len(players) else None}
                  for i in range(9)],
    }
    hand = {'event': 'hand_card', 'player_id': self_id, 'hole_card': ['as', 'ad'], 'hand_strength': 'one_pair'}
    queue = [
        {'event': 'room_status', 'status': {**status, 'state': 'running'}},
        {'event': 'game_status', 'game_id': 'visual-fixed-game', 'status': status},
        {'event': 'table_status', 'status': status},
        *([] if observer else [hand]),
        {'event': 'operating_player_status', 'status': {
            'player_id': others[0] if opponent or observer else self_id, 'remain_operating_seconds': 120,
            'valid_bets': deepcopy(bets)}},
        *([] if observer else [{'event': 'hand_analyse', 'hand_power': 82}]),
    ]
    if part == 'hand':
        return [hand]
    if part == 'without-hand':
        return [item for item in queue if item['event'] != 'hand_card']
    return queue


def zhajinhua_table(self_id, settings):
    opponent, seen = flag(settings, 'opponent'), flag(settings, 'seen')
    players = [self_id, *PLAYERS[:4]]
    call = 20 if seen and not opponent else 10
    status = {
        'state': 'gaming', 'operating_seconds': 120, 'remain_seconds': 3600,
        'settings': {'boot': 1, 'raise_times': 10, 'must_blind_round': 0, 'challenge_limit_round': 1,
                     'max_round': 20, 'pot_limit': 2000},
        'variation': 'classic', 'game_variation': {}, 'pattern': 'tradition', 'number': 1,
        'ante': 1, 'max_round': 20, 'round_count': 3, 'pot': {'pot_amount': 120, 'pot_limit': 2000},
        'seats': [{'number': i + 1, 'state': 'occupied' if i < len(players) else 'empty',
                   'position': 'D' if i == 0 else '', 'reserve': {},
                   'player': {'player_id': players[i], 'seat_number': i + 1, 'stack': 1000 - i * 40,
                              'buy_in': 1000, 'is_leave': False, 'is_playing': True,
                              'is_seen_card': i == 0 and seen, 'is_lose': False,
                              'position': 'D' if i == 0 else '', 'last_action': {'name': 'call', 'amount': 10},
                              'public_hole_card': [], 'hole_card': []} if i < len(players) else None}
                  for i in range(9)],
    }
    return [
        {'event': 'room_status', 'status': {**status, 'state': 'running'}},
        {'event': 'game_status', 'game_id': 'visual-fixed-zhajinhua-game', 'status': status},
        *([{'event': 'hand_card', 'player_id': self_id, 'hole_card': ['as', 'ad', 'ac'],
            'hand_strength': 'three_of_a_kind'}] if seen else []),
        {'event': 'operating_player_status', 'status': {
            'player_id': players[1] if opponent else self_id, 'remain_operating_seconds': 120,
            'valid_bets': {'fold': {}, 'call': {'amount': call}, 'challenge': {'amount': call * 2},
                           'raise': {'minimum': call * 2, 'maximum': call * 10, 'step': call},
                           'all_in': {'amount': 1000}}}},
        {'event': 'table_status', 'status': status},
    ]
