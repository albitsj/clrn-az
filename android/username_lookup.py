"""只回放本轮测试账号的用户名存在性查询，真实登录仍访问原服务。"""

import json
from urllib.parse import urlsplit


def username_lookup_response(request, username):
    if (not isinstance(username, str) or not username
            or request.method != 'PUT'
            or urlsplit(request.path).path != '/public/v10/user/username/is_existed'
            or not (request.host == 'api.shafayouxi.org'
                    or request.host.endswith('.api.staging.laiwan.shafayouxi.com'))):
        return None
    try:
        body = json.loads(request.content)
    except (ValueError, TypeError):
        return None
    if not isinstance(body, dict) or body.get('username') != username:
        return None
    return {'ok': True, 'result': {'is_existed': True}}
