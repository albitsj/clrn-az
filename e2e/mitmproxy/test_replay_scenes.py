"""消息生成契约：身份来自订阅，动画分批顺序及场景间数据隔离。"""

import unittest
from replay_scenes import EVENTS, FILES, replay_scene
from table_scenes import TABLES

SELF = '33333333-3333-4333-8333-333333333333'


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

    def test_table_variants_preserve_seats_pots_and_bet_controls(self):
        for table, count in (('standard', 5), ('observer', 4), ('full', 9), ('full-pots', 9)):
            queue = replay_scene('texas', SELF, {'scene': 'table', 'table': table, 'street': 'river'})['queue']
            status = queue[1]['status']
            self.assertEqual(sum(seat['player'] is not None for seat in status['seats']), count)
            if table == 'observer':
                self.assertNotIn(SELF, [seat['player']['player_id'] for seat in status['seats'] if seat['player']])
                self.assertNotIn('hand_card', [item['event'] for item in queue])
            if table == 'full-pots':
                self.assertEqual(status['pots'], [90, 80, 70, 60, 50, 40, 30, 20, 10])
        for table in TABLES:
            queue = replay_scene('texas', SELF, {'scene': 'table', 'table': table})['queue']
            bets = next(item for item in queue if item['event'] == 'operating_player_status')['status']['valid_bets']
            if table == 'all-in-only':
                self.assertEqual(bets, {'fold': {}, 'all_in': {'amount': 15}})
            elif table == 'all-in-call':
                self.assertEqual(bets['call'], {'amount': 15})
            elif table == 'shortcut-disabled':
                self.assertEqual(bets['raise']['maximum'], 50)
            elif table in ('check', 'shortcut-blinds'):
                self.assertIn('check', bets)

    def test_zhajinhua_order_seen_cards_and_room_status(self):
        for opponent in (False, True):
            for seen in (False, True):
                queue = replay_scene('zhajinhua', SELF, {'scene': 'table', 'seen': seen, 'opponent': opponent})['queue']
                self.assertEqual(queue[-1]['event'], 'table_status')
                operation = queue[-2]['status']
                self.assertEqual(operation['valid_bets']['call']['amount'], 20 if seen and not opponent else 10)
                self.assertEqual([item['hole_card'] for item in queue if item['event'] == 'hand_card'],
                                 [['as', 'ad', 'ac']] if seen else [])
        room = replay_scene('zhajinhua', SELF, {'scene': 'room-status'})['queue']
        self.assertEqual(len(room), 1)
        self.assertEqual(room[0]['status']['state'], 'running')

    def test_all_named_events_are_isolated_and_bind_actual_self(self):
        for game, scenes in EVENTS.items():
            for name in scenes:
                settings = {'scene': name}
                if name in FILES:
                    settings['file'] = FILES[name][0]
                if name == 'player-action':
                    settings['action'] = 'call'
                first = replay_scene(game, SELF, settings)
                self.assertNotIn('$self', str(first))
                self.assertNotIn('$file', str(first))
                if name == 'settlement':
                    self.assertEqual(first['queue'][0]['players'][0]['player_id'], SELF)
                first.clear()
                self.assertTrue(replay_scene(game, SELF, settings), '调用不能污染下一场景或全局数据')

    def test_unknown_scenes_and_arbitrary_protocol_payloads_are_rejected(self):
        for game in ('texas', 'zhajinhua'):
            for settings in (None, [], {}, {'scene': 'unknown'}, {'scene': 'table', 'queue': []},
                             {'scene': 'table', 'opponent': 'false'}, {'scene': 'sticker', 'file': '../../x'}):
                with self.subTest(game=game, settings=settings), self.assertRaises((ValueError, TypeError)):
                    replay_scene(game, SELF, settings)
        for settings in ({'scene': 'table', 'street': 'unknown'}, {'scene': 'table', 'table': 'unknown'},
                         {'scene': 'table', 'part': 'unknown'}, {'scene': 'player-action', 'action': 'unknown'}):
            with self.assertRaises(ValueError):
                replay_scene('texas', SELF, settings)
