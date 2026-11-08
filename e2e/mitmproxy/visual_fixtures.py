"""普通视觉页面所需的少量业务夹具；未声明的流量直接透传。"""

from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit

from mitmproxy import http
from response_overrides import is_staging

FIXTURES = Path(__file__).resolve().parents[2] / 'visual/fixtures'


def load(name):
    return json.loads((FIXTURES / name).read_text())


GOODS = load('shop-goods.json')
HALLS = {game: load(f'hall-matching-{game}.json') for game in ('texas-holdem', 'zhajinhua')}
FEEDBACK = ('<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
            '<body style="margin:0;background:#f5f5f5"></body></html>')
COMMON_ROUTES = (
    (r'/v\d+/alipay_order/goods', GOODS),
    (r'/v11/wallet/[^/]+/currency/(coin|diamond)/statement', {'statements': []}),
    (r'/v10/buy_in/auditor/[^/]+/applications/pending', {'applications': []}),
)
HOUSE_ROUTES = (
    (r'/v10/house/user/[^/]+',
     {'house_id': 'visual-house-id', 'user_id': 'visual-user-id', 'house_number': 123456789}),
    (r'/v10/house/users/[^/]+/visit_history', {'house_numbers': []}),
)


def fixed_results():
    return {
        '/public/v10/profile/country': {'countryPhoneCode': '86'},
        '/v2/room/disallow-rule/reminder': {'enable': False, 'message': ''},
        '/public/v1/hall_matching/available.json': {'available_url_version': ['v3']},
        '/v2/check_in/seven_day/rule': [
            {'times': i, 'reward': {'coin': i * 100}} for i in range(1, 8)],
        '/v2/check_in/seven_day/current': [
            {'check_in_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}],
        '/v10/club/application': {'applications': []},
    }


def matching_result(path, routes):
    for pattern, result in routes:
        if re.fullmatch(pattern, path):
            return route_payload(result)
    return None


def route_payload(result):
    return result if result is GOODS else deepcopy(result)


def is_chat(host):
    return host == 'freshchat.com' or host.endswith('.freshchat.com')


def is_feedback(request):
    return request.host == 'feedback.userreport.com' and request.method == 'GET'


def blocks_payment(request):
    return re.match(r'/v\d+/alipay_order(?:/|$)', urlsplit(request.path).path) and request.method != 'GET'


class VisualFixtures:
    def __init__(self, scene):
        if scene not in ('pages', 'game', 'records'):
            raise ValueError('Unknown visual scene')
        self.scene = scene

    def result(self, request):
        handlers = {'GET': self.get_result, 'PUT': self.put_result}
        return handlers.get(request.method, self.unmatched)(urlsplit(request.path))

    def unmatched(self, url):
        return None

    def get_result(self, url):
        fixed = fixed_results()
        fixed.update({f'/public/v1/hall_matching/{game.replace("-", "_")}/halls': data['result']
                      for game, data in HALLS.items()})
        return self.get_path_result(url, fixed)

    def get_path_result(self, url, fixed):
        if url.path in fixed:
            return fixed[url.path]
        if url.path == '/v10/club':
            return self.club_result(url)
        return matching_result(url.path, self.get_routes())

    def get_routes(self):
        return COMMON_ROUTES if self.scene == 'game' else (*COMMON_ROUTES, *HOUSE_ROUTES)

    def club_result(self, url):
        if self.scene == 'records':
            return None
        if 'user_id' in parse_qs(url.query, keep_blank_values=True):
            return {'clubs': []}
        return None

    def put_result(self, url):
        # 这两个 PUT 是读取批量资料/列表，不是创建或修改业务实体。
        scenes = {'/v10/clubs': ('pages', 'game'), '/v2/building/rooms': ('pages', 'records')}
        return [] if self.scene in scenes.get(url.path, ()) else None

    def third_party_handler(self, request):
        if is_chat(request.host):
            return self.kill_chat
        if is_feedback(request):
            return self.feedback
        return self.staging_request

    def kill_chat(self, flow):
        flow.kill()

    def feedback(self, flow):
        flow.response = http.Response.make(200, FEEDBACK.encode(), {'Content-Type': 'text/html; charset=utf-8'})

    def request(self, flow):
        if flow.request.method in ('OPTIONS', 'CONNECT'):
            return
        self.third_party_handler(flow.request)(flow)

    def staging_request(self, flow):
        if not is_staging(flow.request.host):
            return
        # 商品只读夹具不能使真实支付写入意外透传。
        if blocks_payment(flow.request):
            flow.response = http.Response.make(403, b'Visual tests cannot create payment orders')
            return
        self.respond(flow, self.result(flow.request))

    def respond(self, flow, result):
        if result is not None:
            flow.response = http.Response.make(200, json.dumps({'ok': True, 'result': result}).encode(), {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
                'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
            })
