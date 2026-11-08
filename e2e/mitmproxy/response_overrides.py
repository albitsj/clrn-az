"""视觉代理只覆盖必要字段；真实错误、响应头和新增字段继续交给客户端。"""

import json
import logging
from urllib.parse import urlsplit


def is_staging(host):
    return host == 'api.shafayouxi.org' or host.endswith('.api.staging.laiwan.shafayouxi.com')


def successful_response(response):
    return bool(response) and response.status_code == 200


def successful_body(body):
    return isinstance(body, dict) and body.get('ok') is True


def result_object(body):
    result = body.get('result')
    if not isinstance(result, dict):
        raise ValueError('Expected result object')
    return result


def write_response(flow, body):
    flow.response.content = json.dumps(body).encode()
    # 原响应的缓存校验值已失效，保留其他头（包括 CORS 和压缩编码）。
    for header in ('ETag', 'Content-MD5', 'Digest'):
        flow.response.headers.pop(header, None)


def change_result(flow, change):
    body = flow.response.json()
    if not successful_body(body):
        return False
    if not change(result_object(body)):
        return False
    write_response(flow, body)
    return True


def patch_result(flow, change):
    """change 原地修改成功响应的 result；结构变化时保留原文并提示，禁止兜底成功。"""
    if not successful_response(flow.response):
        return False
    try:
        return change_result(flow, change)
    except (ValueError, TypeError, KeyError, AttributeError):
        logging.warning('Visual override skipped: response contract changed at %s',
                        urlsplit(flow.request.path).path)
        return False


def patch_version(flow, version):
    def change(result):
        if not isinstance(result.get('available_url_version'), str):
            raise ValueError('Expected version string')
        result['available_url_version'] = version
        return True
    return patch_result(flow, change)


def valid_self(self_id):
    return isinstance(self_id, str) and bool(self_id)


def is_profile_request(request, self_id):
    if not valid_self(self_id):
        return False
    return request.method == 'PUT' and urlsplit(request.path).path == '/v10/profile/users'


def includes_self(users, self_id):
    return isinstance(users, list) and self_id in users


def known_profile_users(users, self_id, virtual_ids):
    if not includes_self(users, self_id):
        return False
    return set(users) <= {self_id, *virtual_ids}


def prepare_profile_request(flow, self_id, virtual_ids):
    body = flow.request.json()
    users = body.get('users')
    if not known_profile_users(users, self_id, virtual_ids):
        return False
    if not set(users) & set(virtual_ids):
        return False
    flow.metadata['visual_profile_users'] = users
    body['users'] = [self_id]
    flow.request.content = json.dumps(body).encode()
    return True


def prepare_profiles(flow, self_id, virtual_ids):
    """混合批次只向上游查询真实本人，虚拟 UUID 不会导致真实接口返回找不到用户。"""
    if not is_profile_request(flow.request, self_id):
        return False
    try:
        return prepare_profile_request(flow, self_id, virtual_ids)
    except (ValueError, TypeError, AttributeError):
        return False


def selected_profiles(profiles, users):
    return {user: profile for user, profile in profiles.items() if user in users}


def merged_profile(original, profile):
    return {**(original or {}), **profile}


def patch_selected_profiles(flow, self_id, selected):
    if not selected:
        return False

    def change(result):
        # 本人资料缺失也不伪造；让客户端看到真实接口变化。
        if not isinstance(result.get(self_id), dict):
            raise ValueError('Missing current user profile')
        for user, profile in selected.items():
            result[user] = merged_profile(result.get(user), profile)
        return True
    return patch_result(flow, change)


def profile_users(flow, self_id, profiles):
    users = flow.metadata.get('visual_profile_users', flow.request.json().get('users'))
    if not known_profile_users(users, self_id, profiles):
        return None
    return users


def patch_requested_profiles(flow, self_id, profiles, users):
    if users is None:
        return False
    return patch_selected_profiles(flow, self_id, selected_profiles(profiles, users))


def patch_profiles(flow, self_id, profiles):
    """混合批次从真实接口取得本人资料，仅补入回放虚拟玩家；其他账号批次透传。"""
    if not is_profile_request(flow.request, self_id):
        return False
    try:
        users = profile_users(flow, self_id, profiles)
    except (ValueError, TypeError, AttributeError):
        return False
    return patch_requested_profiles(flow, self_id, profiles, users)
