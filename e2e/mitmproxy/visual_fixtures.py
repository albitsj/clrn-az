"""普通视觉页面所需的少量业务夹具；未声明的流量直接透传。"""

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


class VisualFixtures:
    def __init__(self, scene):
        if scene not in ('pages', 'game', 'records'):
            raise ValueError('Unknown visual scene')
        self.scene = scene

    def result(self, request):
        url = urlsplit(request.path)
        path, method = url.path, request.method
        if method == 'GET':
            fixed = {
                '/public/v10/profile/country': {'countryPhoneCode': '86'},
                '/v2/room/disallow-rule/reminder': {'enable': False, 'message': ''},
                '/public/v1/hall_matching/available.json': {'available_url_version': ['v3']},
                '/v2/check_in/seven_day/rule': [
                    {'times': i, 'reward': {'coin': i * 100}} for i in range(1, 8)],
                '/v2/check_in/seven_day/current': [
                    {'check_in_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}],
                '/v10/club/application': {'applications': []},
            }
            if path in fixed:
                return fixed[path]
            for game, data in HALLS.items():
                if path == f'/public/v1/hall_matching/{game.replace("-", "_")}/halls':
                    return data['result']
            if re.fullmatch(r'/v\d+/alipay_order/goods', path):
                return GOODS
            if re.fullmatch(r'/v11/wallet/[^/]+/currency/(coin|diamond)/statement', path):
                return {'statements': []}
            if re.fullmatch(r'/v10/buy_in/auditor/[^/]+/applications/pending', path):
                return {'applications': []}
            if self.scene != 'records' and path == '/v10/club' and 'user_id' in parse_qs(url.query, keep_blank_values=True):
                return {'clubs': []}
            if self.scene != 'game':
                if re.fullmatch(r'/v10/house/user/[^/]+', path):
                    return {'house_id': 'visual-house-id', 'user_id': 'visual-user-id', 'house_number': 123456789}
                if re.fullmatch(r'/v10/house/users/[^/]+/visit_history', path):
                    return {'house_numbers': []}
        # 这两个 PUT 是读取批量资料/列表，不是创建或修改业务实体。
        if self.scene != 'records' and path == '/v10/clubs' and method == 'PUT':
            return []
        if self.scene != 'game' and path == '/v2/building/rooms' and method == 'PUT':
            return []
        return None

    def request(self, flow):
        if flow.request.method in ('OPTIONS', 'CONNECT'):
            return
        host = flow.request.host
        if host == 'freshchat.com' or host.endswith('.freshchat.com'):
            flow.kill()
            return
        if host == 'feedback.userreport.com' and flow.request.method == 'GET':
            flow.response = http.Response.make(200, FEEDBACK.encode(), {'Content-Type': 'text/html; charset=utf-8'})
            return
        if not is_staging(host):
            return
        # 商品只读夹具不能使真实支付写入意外透传。
        if (re.match(r'/v\d+/alipay_order(?:/|$)', urlsplit(flow.request.path).path)
                and flow.request.method != 'GET'):
            flow.response = http.Response.make(403, b'Visual tests cannot create payment orders')
            return
        result = self.result(flow.request)
        if result is not None:
            flow.response = http.Response.make(200, json.dumps({'ok': True, 'result': result}).encode(), {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
                'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
            })
