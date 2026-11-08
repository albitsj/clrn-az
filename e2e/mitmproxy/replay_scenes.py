"""命名回放场景；控制调用不能上传任意响应或修改已确认的订阅身份。"""

from datetime import datetime, timezone
import json
from pathlib import Path

from table_scenes import texas_table, zhajinhua_table

DIRECTORY = Path(__file__).resolve().parent / 'fixtures'
EVENTS = {game: json.loads((DIRECTORY / f'{game}-events.json').read_text()) for game in ('texas', 'zhajinhua')}
FILES = {
    'sticker': ('angry', 'cry', 'drink', 'puchi', 'titter', 'smirk', 'handclap'),
    'props': ('tomato', 'tea', 'water', 'flower', 'heart', 'good', 'beer'),
}


def substitute_object(value, replacements):
    return {key: substitute(item, replacements) for key, item in value.items()}


def substitute_array(value, replacements):
    return [substitute(item, replacements) for item in value]


def substitute_scalar(value, replacements):
    return replacements.get(value, value) if isinstance(value, str) else value


def substitute(value, replacements):
    if isinstance(value, dict):
        return substitute_object(value, replacements)
    if isinstance(value, list):
        return substitute_array(value, replacements)
    return substitute_scalar(value, replacements)


def require_option(value, options, message):
    if value not in options:
        raise ValueError(message)


def scene_parameters(game, scene, settings):
    if scene in FILES:
        require_option(settings.get('file'), FILES[scene], 'Unknown animation asset')
        return {'scene', 'file'}
    if scene == 'player-action':
        require_option(settings.get('action'), ('call', 'raise', 'check', 'fold'), 'Unknown player action')
        return {'scene', 'action'}
    return table_parameters(game, scene)


def table_parameters(game, scene):
    if scene != 'table':
        return {'scene'}
    fields = {'street', 'opponent', 'table', 'part'} if game == 'texas' else {'opponent', 'seen'}
    return {'scene', *fields}


def validate_scene(game, settings):
    if not isinstance(settings, dict) or not isinstance(settings.get('scene'), str):
        raise ValueError('Expected named replay scene')
    validate_parameters(game, settings)
    return settings['scene']


def validate_parameters(game, settings):
    if settings.keys() - scene_parameters(game, settings['scene'], settings):
        raise ValueError('Unknown scene parameters')


def is_table_scene(game, scene):
    return scene == 'table' or (game, scene) == ('zhajinhua', 'room-status')


def table_data(game, scene, self_id, settings):
    build = texas_table if game == 'texas' else zhajinhua_table
    queue = build(self_id, settings)
    if scene == 'room-status':
        queue = queue[:1]
    return {'stream': {'texas': 'texas_holdem'}.get(game, game), 'queue': queue}


def event_data(game, scene, self_id, settings):
    if scene not in EVENTS[game]:
        raise ValueError('Unknown replay scene')
    return substitute(EVENTS[game][scene], {'$self': self_id, '$file': settings.get('file'),
                                           '$action': settings.get('action')})


def replay_scene(game, self_id, settings):
    scene = validate_scene(game, settings)
    if is_table_scene(game, scene):
        data = table_data(game, scene, self_id, settings)
    else:
        data = event_data(game, scene, self_id, settings)
    if 'queue' in data:
        data['sent_at'] = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return data
