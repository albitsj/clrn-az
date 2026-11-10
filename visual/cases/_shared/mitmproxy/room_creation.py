"""Validate real room creation responses before binding visual fixtures."""

ROOM_PATHS = ('/v2/building/$building_id$/room', '/v2/building/<building_id>/room')


def create_action(action):
    if not isinstance(action, dict):
        return False
    return action.get('method') == 'POST' and action.get('path') in ROOM_PATHS


def game_config(config, games):
    return isinstance(config, dict) and config.get('game_type') in games


def creation_request(request, games):
    return create_action(request.get('action_url')) and game_config(request.get('action_json'), games)


def successful_result(body):
    if body.get('ok') is not True:
        return None
    result = body.get('result')
    return result if isinstance(result, dict) else None


def successful_response(flow):
    return flow.response and flow.response.status_code == 200


def is_creation_request(flow, path):
    return flow.request.method == 'POST' and path == '/v3/pay_action/do'
