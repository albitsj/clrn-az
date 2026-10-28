"""迁移后的 HTTP 业务契约及真实认证/支付/选线边界。"""

from datetime import datetime, timezone
import unittest

from test_network_faults import flow
from visual_fixtures import VisualFixtures

ORIGIN = 'https://67.hk.api.staging.laiwan.shafayouxi.com'


class VisualFixtureTests(unittest.TestCase):
    def request(self, path, method='GET', scene='pages', origin=ORIGIN):
        request = flow(origin + path, method)
        VisualFixtures(scene).request(request)
        return request

    def result(self, path, method='GET', scene='pages'):
        response = self.request(path, method, scene).response
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Content-Type'], 'application/json')
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], '*')
        self.assertIs(response.json()['ok'], True)
        return response.json()['result']

    def test_country_halls_and_shop_keep_existing_contract(self):
        self.assertEqual(self.result('/public/v10/profile/country?x=1'), {'countryPhoneCode': '86'})
        self.assertEqual(self.result('/v2/room/disallow-rule/reminder'), {'enable': False, 'message': ''})
        self.assertEqual(self.result('/public/v1/hall_matching/available.json'), {'available_url_version': ['v3']})
        for game in ('texas_holdem', 'zhajinhua'):
            halls = self.result(f'/public/v1/hall_matching/{game}/halls')['halls']
            self.assertGreater(len(halls), 0)
        goods = self.result('/v10/alipay_order/goods')
        self.assertEqual([item['amount'] for item in goods], [1, 60, 120, 300, 1280, 3280, 6480])
        self.assertEqual(goods[-1]['total_amount'], '648')

    def test_lists_and_check_in_are_read_only_and_today(self):
        self.assertEqual(self.result('/v10/club?user_id=self'), {'clubs': []})
        self.assertEqual(self.result('/v10/club?user_id='), {'clubs': []})
        self.assertEqual(self.result('/v10/clubs', 'PUT'), [])
        self.assertEqual(self.result('/v10/house/user/self')['house_number'], 123456789)
        self.assertEqual(self.result('/v10/house/users/self/visit_history'), {'house_numbers': []})
        self.assertEqual(self.result('/v2/building/rooms', 'PUT'), [])
        for path in ('/v10/club/application', '/v10/buy_in/auditor/self/applications/pending'):
            self.assertEqual(self.result(path), {'applications': []})
        for currency in ('coin', 'diamond'):
            self.assertEqual(self.result(f'/v11/wallet/self/currency/{currency}/statement'), {'statements': []})
        self.assertEqual([day['reward']['coin'] for day in self.result('/v2/check_in/seven_day/rule')],
                         [100, 200, 300, 400, 500, 600, 700])
        now = datetime.now(timezone.utc)
        date = self.result('/v2/check_in/seven_day/current')[0]['check_in_at']
        self.assertLess(abs((now - datetime.fromisoformat(date.replace('Z', '+00:00'))).total_seconds()), 5)
        for path in ('/public/v10/profile/country', '/v2/room/disallow-rule/reminder', '/v10/club',
                     '/v10/house/user/self', '/v10/club/application', '/v2/check_in/seven_day/current'):
            for method in ('POST', 'PUT', 'DELETE', 'OPTIONS'):
                self.assertIsNone(self.request(path, method).response, (path, method))

    def test_specialized_fixtures_keep_priority_and_real_room_creation(self):
        for path, method in (('/v10/house/user/self', 'GET'), ('/v10/house/users/self/visit_history', 'GET'),
                             ('/v2/building/rooms', 'PUT')):
            self.assertIsNone(self.request(path, method, 'game').response)
        for path, method in (('/v10/club?user_id=self', 'GET'), ('/v10/clubs', 'PUT')):
            self.assertIsNone(self.request(path, method, 'records').response)
        for scene in ('pages', 'game', 'records'):
            for path in ('/public/v10/user/login/username/password', '/v3/pay_action/do'):
                self.assertIsNone(self.request(path, 'POST', scene).response)
            self.assertIsNone(self.request('/v1/room/real-room', 'DELETE', scene).response)
            self.assertEqual(len(self.result('/v10/alipay_order/goods', scene=scene)), 7)
            for method in ('POST', 'PUT', 'DELETE'):
                self.assertEqual(self.request('/v10/alipay_order', method, scene).response.status_code, 403)

    def test_unmatched_hosts_paths_preflight_and_third_party_boundaries(self):
        paths = ('/public/v12/metadata/servers', '/public/v13/metadata/servers', '/node/v1/status', '/unknown')
        for scene in ('pages', 'game', 'records'):
            for path in paths:
                for method in ('GET', 'OPTIONS'):
                    self.assertIsNone(self.request(path, method, scene).response)
            for origin in ('https://production.example.com', 'https://api.shafayouxi.org.evil.test'):
                self.assertIsNone(self.request('/public/v10/profile/country', scene=scene, origin=origin).response)
        self.assertIsNone(self.request('/v10/alipay_order/goods', 'OPTIONS').response)
        chat = self.request('/', origin='https://widget.freshchat.com')
        self.assertIsNotNone(chat.error)
        feedback = self.request('/visual-fixture/', origin='https://feedback.userreport.com').response
        self.assertEqual(feedback.headers['Content-Type'], 'text/html; charset=utf-8')
        self.assertIn('<body style="margin:0;background:#f5f5f5"></body>', feedback.text)
        self.assertIsNone(self.request('/', origin='https://freshchat.com.evil.test').response)
