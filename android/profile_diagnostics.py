"""只读房间资料 RPC 元数据，不记录用户、房间、正文或错误文本。"""

import re


def room_profile_path(path):
    return isinstance(path, str) and re.fullmatch(r'/v10/texas_holdem/room/[^/]+/profile', path) is not None


def observe_profile_frame(observer, flow, message, frame):
    """诊断异常不得中断生产 websocket 处理或修改消息。"""
    try:
        _observe_profile_frame(observer, flow, message, frame)
    except Exception:
        pass


def _observe_profile_frame(observer, flow, message, frame):
    pending = flow.metadata.setdefault('room_profile_diagnostic_pending', set())
    request_id = frame['id']
    if message.from_client:
        params = frame.get('params', {})
        data = params.get('data', {}) if isinstance(params, dict) else {}
        if frame.get('method') == 9 and isinstance(data, dict) and room_profile_path(data.get('path')):
            if len(pending) >= 100:
                pending.clear()
            pending.add(request_id)
            observer.observe(flow, 'room-profile-request')
    elif request_id in pending:
        pending.discard(request_id)
        result = frame.get('result')
        body = result.get('data') if isinstance(result, dict) else None
        observer.observe(flow, 'room-profile-response', transportError='error' in frame,
                         **profile_shape(body))


def profile_shape(body):
    """按实际 RPC 的嵌套结构统计盲注规则，不能将业务内容写入附件。"""
    body = profile_body(body)
    result = body.get('result')
    rules = result.get('all_time_based_rule') if isinstance(result, dict) else None
    return {'rpcOk': body.get('ok') if type(body.get('ok')) is bool else None,
            'resultEntries': collection_size(result), 'ruleEntries': collection_size(rules)}


def collection_size(value):
    """只返回集合大小；缺失或无效类型必须与真实空集合区分。"""
    return len(value) if isinstance(value, (dict, list)) else None


def profile_body(value):
    """兼容应用已支持的旧响应和含 http_code/json 的第二版信封。"""
    value = value if isinstance(value, dict) else {}
    if type(value.get('http_code')) in (int, float):
        body = value.get('json')
        return body if isinstance(body, dict) else {}
    return value
