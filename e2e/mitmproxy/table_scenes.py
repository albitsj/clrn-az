"""牌桌布局只在代理构造；测试端仅选择有限的展示分支。"""

from copy import deepcopy

PLAYERS = [f'00000000-0000-4000-8000-{i:012}' for i in range(1, 9)]
DEFAULT_BETS = {'fold': {}, 'call': {'amount': 20}, 'raise': {'minimum': 40, 'maximum': 1000},
                'all_in': {'amount': 1000}}
CHECK_BETS = {'fold': {}, 'check': {}, 'raise': {'minimum': 40, 'maximum': 1000}, 'all_in': {'amount': 1000}}
TABLES = ('standard', 'observer', 'full', 'full-pots', 'check', 'all-in-only', 'all-in-call',
          'shortcut-blinds', 'shortcut-disabled')
STREETS = {'preflop': 0, 'flop': 3, 'turn': 4, 'river': 5}
BET_VARIANTS = {
    'check': CHECK_BETS, 'shortcut-blinds': CHECK_BETS,
    'all-in-only': {'fold': {}, 'all_in': {'amount': 15}},
    'all-in-call': {'fold': {}, 'call': {'amount': 15}, 'all_in': {'amount': 15}},
    'shortcut-disabled': {'fold': {}, 'call': {'amount': 20}, 'raise': {'minimum': 40, 'maximum': 50},
                          'all_in': {'amount': 50}},
}


def flag(settings, name):
    value = settings.get(name, False)
    if not isinstance(value, bool):
        raise ValueError('Expected boolean scene parameter')
    return value


def table_options(settings):
    choices = (('street', 'preflop', STREETS), ('table', 'standard', TABLES),
               ('part', 'all', ('all', 'without-hand', 'hand')))
    for name, default, allowed in choices:
        if settings.get(name, default) not in allowed:
            raise ValueError('Unknown table scene')
    return settings.get('street', 'preflop'), settings.get('table', 'standard'), settings.get('part', 'all')


def table_positions(full):
    return ['BTN', 'SB', 'BB', 'UTG', 'MP1', 'MP2', 'MP3', 'HJ', 'CO'] if full else ['D', 'SB', 'BB', 'UTG', 'CO']


def table_pots(street, table):
    default = [6] if street == 'preflop' else [120, 60]
    return {'full-pots': [90, 80, 70, 60, 50, 40, 30, 20, 10], 'shortcut-blinds': [3]}.get(table, default)


def player_base(player_id, index, position):
    return {'player_id': player_id, 'seat_number': index + 1, 'stack': 1000 - index * 40,
            'buy_in': 1000, 'is_leave': False, 'is_playing': True, 'position': position,
            'public_hole_card': [], 'hole_card': []}


def texas_player(player_id, index, position):
    return {**player_base(player_id, index, position),
            'last_action': {'name': 'fold' if index == 3 else 'call', 'amount': 20}}


def seat(index, position, player):
    return {'number': index + 1, 'state': 'occupied' if player is not None else 'empty',
            'position': position, 'reserve': {}, 'player': player}


def texas_seat(index, players, positions):
    position = positions[index] if index < len(positions) else ''
    player = texas_player(players[index], index, positions[index]) if index < len(players) else None
    return seat(index, position, player)


def texas_status(street, table, players, positions):
    return {
        'state': 'gaming', 'operating_seconds': 120, 'remain_seconds': 3600,
        'settings': {'small_blind': 1, 'big_blind': 2, 'ante': 0},
        'small_blind': 1, 'big_blind': 2, 'ante': 0, 'variation': 'texas_holdem',
        'game_variation': {}, 'pattern': 'tradition', 'number': 1, 'street': street,
        'community_card': ['ah', 'kd', '7c', '2s', 'qs'][:STREETS[street]], 'pots': table_pots(street, table),
        'seats': [texas_seat(i, players, positions) for i in range(9)],
    }


def own_events(observer, events):
    return [] if observer else events


def operating_player(self_id, others, opponent, observer):
    return others[0] if opponent or observer else self_id


def texas_queue(status, hand, observer, operator, bets):
    return [
        {'event': 'room_status', 'status': {**status, 'state': 'running'}},
        {'event': 'game_status', 'game_id': 'visual-fixed-game', 'status': status},
        {'event': 'table_status', 'status': status},
        *own_events(observer, [hand]),
        {'event': 'operating_player_status', 'status': {
            'player_id': operator, 'remain_operating_seconds': 120, 'valid_bets': deepcopy(bets)}},
        *own_events(observer, [{'event': 'hand_analyse', 'hand_power': 82}]),
    ]


def without_hand(queue):
    return [item for item in queue if item['event'] != 'hand_card']


def queue_part(queue, hand, part):
    if part == 'hand':
        return [hand]
    if part == 'without-hand':
        return without_hand(queue)
    return queue


def texas_table(self_id, settings):
    street, table, part = table_options(settings)
    opponent = flag(settings, 'opponent')
    observer, full = table == 'observer', table in ('full', 'full-pots')
    others = PLAYERS if full else PLAYERS[:4]
    players = others if observer else [self_id, *others]
    status = texas_status(street, table, players, table_positions(full))
    hand = {'event': 'hand_card', 'player_id': self_id, 'hole_card': ['as', 'ad'], 'hand_strength': 'one_pair'}
    queue = texas_queue(status, hand, observer, operating_player(self_id, others, opponent, observer),
                        BET_VARIANTS.get(table, DEFAULT_BETS))
    return queue_part(queue, hand, part)


def zhajinhua_player(player_id, index, position, seen):
    return {**player_base(player_id, index, position), 'is_seen_card': index == 0 and seen,
            'is_lose': False, 'last_action': {'name': 'call', 'amount': 10}}


def zhajinhua_seat(index, players, seen):
    position = 'D' if index == 0 else ''
    player = zhajinhua_player(players[index], index, position, seen) if index < len(players) else None
    return seat(index, position, player)


def zhajinhua_status(players, seen):
    return {
        'state': 'gaming', 'operating_seconds': 120, 'remain_seconds': 3600,
        'settings': {'boot': 1, 'raise_times': 10, 'must_blind_round': 0, 'challenge_limit_round': 1,
                     'max_round': 20, 'pot_limit': 2000},
        'variation': 'classic', 'game_variation': {}, 'pattern': 'tradition', 'number': 1,
        'ante': 1, 'max_round': 20, 'round_count': 3, 'pot': {'pot_amount': 120, 'pot_limit': 2000},
        'seats': [zhajinhua_seat(i, players, seen) for i in range(9)],
    }


def seen_hand(self_id, seen):
    return [{'event': 'hand_card', 'player_id': self_id, 'hole_card': ['as', 'ad', 'ac'],
             'hand_strength': 'three_of_a_kind'}] if seen else []


def zhajinhua_bets(call):
    return {'fold': {}, 'call': {'amount': call}, 'challenge': {'amount': call * 2},
            'raise': {'minimum': call * 2, 'maximum': call * 10, 'step': call}, 'all_in': {'amount': 1000}}


def zhajinhua_table(self_id, settings):
    opponent, seen = flag(settings, 'opponent'), flag(settings, 'seen')
    players = [self_id, *PLAYERS[:4]]
    call = 20 if seen and not opponent else 10
    return zhajinhua_queue(self_id, players, opponent, seen, call)


def zhajinhua_queue(self_id, players, opponent, seen, call):
    status = zhajinhua_status(players, seen)
    return [
        {'event': 'room_status', 'status': {**status, 'state': 'running'}},
        {'event': 'game_status', 'game_id': 'visual-fixed-zhajinhua-game', 'status': status},
        *seen_hand(self_id, seen),
        {'event': 'operating_player_status', 'status': {
            'player_id': players[1] if opponent else self_id, 'remain_operating_seconds': 120,
            'valid_bets': zhajinhua_bets(call)}},
        {'event': 'table_status', 'status': status},
    ]
