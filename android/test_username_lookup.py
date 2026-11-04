"""验证只回放指定账号的只读查询，其他认证请求继续访问原服务。"""

import json
import unittest
from types import SimpleNamespace

from username_lookup import username_lookup_response


def request(path, method='PUT', body=None, host='64.kr-seoul.api.staging.laiwan.shafayouxi.com'):
    return SimpleNamespace(path=path, method=method, host=host,
                           content=json.dumps(body).encode() if body is not None else b'')


class UsernameLookupTests(unittest.TestCase):
    def test_只回放本轮测试账号的用户名查询(self):
        lookup = request('/public/v10/user/username/is_existed', body={'username': '本轮账号'})
        self.assertEqual(username_lookup_response(lookup, '本轮账号'),
                         {'ok': True, 'result': {'is_existed': True}})
        self.assertIsNone(username_lookup_response(lookup, '其他账号'))

    def test_其他地址方法和登录请求保持透传(self):
        candidates = (
            request('/public/v10/user/username/is_existed', body={'username': '其他账号'}),
            request('/public/v10/user/username/is_existed', 'GET', {'username': '本轮账号'}),
            request('/public/v10/user/login/username/password', 'POST', {'username': '本轮账号'}),
            request('/public/v10/user/username/is_existed', body={'username': '本轮账号'},
                    host='api.production.example.com'),
            request('/public/v10/user/username/is_existed', body=None),
        )
        for candidate in candidates:
            self.assertIsNone(username_lookup_response(candidate, '本轮账号'))


if __name__ == '__main__':
    unittest.main()
