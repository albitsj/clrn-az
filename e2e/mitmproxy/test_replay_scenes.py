"""消息生成契约：身份来自订阅，动画分批顺序及场景间数据隔离。"""

from itertools import product
import unittest
from replay_scenes import EVENTS, FILES, replay_scene
from table_scenes import TABLES

SELF = '33333333-3333-4333-8333-333333333333'
BET_EXPECTATIONS = {
    'all-in-only': {'all_in': {'amount': 15}, 'fold': {}},
    'all-in-call': {'call': {'amount': 15}},
    'shortcut-disabled': {'raise': {'minimum': 40, 'maximum': 50}},
    'check': {'check': {}}, 'shortcut-blinds': {'check': {}},
}


def operating_status(queue):
    return next(item for item in queue if item['event'] == 'operating_player_status')['status']


def named_settings(name):
    settings = {'scene': name}
    if name in FILES:
        settings['file'] = FILES[name][0]
    if name == 'player-action':
        settings['action'] = 'call'
    return settings


class ReplaySceneTests(unittest.TestCase):
    def test_texas_table_event_order_cards_and_animation_split(self):
        for street, count in (('preflop', 0), ('flop', 3), ('turn', 4), ('river', 5)):
            settings = {'scene': 'table', 'street': street}
            result = replay_scene('texas', SELF, settings)
            queue = result['queue']
            self.assertEqual([item['event'] for item in queue], ['room_status', 'game_status', 'table_status',
                'hand_card', 'operating_player_status', 'hand_analyse'])
            self.assertEqual(queue[1]['status']['community_card'], ['ah', 'kd', '7c', '2s', 'qs'][:count])
            self.assertEqual(queue[3]['player_id'], SELF)
            self.assertEqual(queue[3]['hole_card'], ['as', 'ad'])
            self.assertEqual(queue[4]['status']['player_id'], SELF)
            without = replay_scene('texas', SELF, {**settings, 'part': 'without-hand'})['queue']
            hand = replay_scene('texas', SELF, {**settings, 'part': 'hand'})['queue']
            self.assertEqual(hand, [queue[3]])
            self.assertEqual(without[:3] + hand + without[3:], queue)

    def test_table_variants_preserve_seat_counts(self):
        for table, count in (('standard', 5), ('observer', 4), ('full', 9), ('full-pots', 9)):
            queue = replay_scene('texas', SELF, {'scene': 'table', 'table': table, 'street': 'river'})['queue']
            self.assertEqual(sum(seat['player'] is not None for seat in queue[1]['status']['seats']), count)

    def test_observer_has_no_self_or_hand(self):
        queue = replay_scene('texas', SELF, {'scene': 'table', 'table': 'observer', 'street': 'river'})['queue']
        players = [seat['player']['player_id'] for seat in queue[1]['status']['seats'] if seat['player']]
        self.assertNotIn(SELF, players)
        self.assertNotIn('hand_card', list(map(event_name, queue)))

    def test_full_pots_preserve_amounts(self):
        queue = replay_scene('texas', SELF, {'scene': 'table', 'table': 'full-pots', 'street': 'river'})['queue']
        self.assertEqual(queue[1]['status']['pots'], [90, 80, 70, 60, 50, 40, 30, 20, 10])

    def test_table_variants_preserve_bet_controls(self):
        for table in TABLES:
            queue = replay_scene('texas', SELF, {'scene': 'table', 'table': table})['queue']
            self.assert_bets(operating_status(queue)['valid_bets'], BET_EXPECTATIONS.get(table, {}))

    def assert_bets(self, bets, expected):
        for name, value in expected.items():
            self.assertEqual(bets[name], value)

    def test_all_in_only_has_no_other_actions(self):
        queue = replay_scene('texas', SELF, {'scene': 'table', 'table': 'all-in-only'})['queue']
        self.assertEqual(operating_status(queue)['valid_bets'], {'fold': {}, 'all_in': {'amount': 15}})

    def test_zhajinhua_order_seen_cards(self):
        cases = ((False, False, 10, []), (False, True, 20, [['as', 'ad', 'ac']]),
                 (True, False, 10, []), (True, True, 10, [['as', 'ad', 'ac']]))
        for opponent, seen, call, cards in cases:
            with self.subTest(opponent=opponent, seen=seen):
                self.assert_zhajinhua(opponent, seen, call, cards)

    def assert_zhajinhua(self, opponent, seen, call, cards):
        queue = replay_scene('zhajinhua', SELF, {'scene': 'table', 'seen': seen, 'opponent': opponent})['queue']
        self.assertEqual(queue[-1]['event'], 'table_status')
        self.assertEqual(queue[-2]['status']['valid_bets']['call']['amount'], call)
        self.assertEqual([item['hole_card'] for item in queue if item['event'] == 'hand_card'], cards)

    def test_zhajinhua_room_status(self):
        room = replay_scene('zhajinhua', SELF, {'scene': 'room-status'})['queue']
        self.assertEqual(len(room), 1)
        self.assertEqual(room[0]['status']['state'], 'running')

    def test_all_named_events_are_isolated_and_bind_actual_self(self):
        for game, scenes in EVENTS.items():
            for name in scenes:
                self.assert_named_scene(game, name)

    def assert_named_scene(self, game, name):
        settings = named_settings(name)
        first = replay_scene(game, SELF, settings)
        self.assertNotIn('$self', str(first))
        self.assertNotIn('$file', str(first))
        if name == 'settlement':
            self.assertEqual(first['queue'][0]['players'][0]['player_id'], SELF)
        first.clear()
        self.assertTrue(replay_scene(game, SELF, settings), '调用不能污染下一场景或全局数据')

    def test_unknown_scenes_and_arbitrary_protocol_payloads_are_rejected(self):
        invalid = (None, [], {}, {'scene': 'unknown'}, {'scene': 'table', 'queue': []},
                   {'scene': 'table', 'opponent': 'false'}, {'scene': 'sticker', 'file': '../../x'})
        for game, settings in product(('texas', 'zhajinhua'), invalid):
            with self.subTest(game=game, settings=settings), self.assertRaises((ValueError, TypeError)):
                replay_scene(game, SELF, settings)

    def test_unknown_table_and_player_action_parameters_are_rejected(self):
        for settings in ({'scene': 'table', 'street': 'unknown'}, {'scene': 'table', 'table': 'unknown'},
                         {'scene': 'table', 'part': 'unknown'}, {'scene': 'player-action', 'action': 'unknown'}):
            with self.assertRaises(ValueError):
                replay_scene('texas', SELF, settings)


def event_name(item):
    return item['event']
