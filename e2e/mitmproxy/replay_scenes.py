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


def substitute(value, replacements):
    if isinstance(value, dict):
        return {key: substitute(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [substitute(item, replacements) for item in value]
    return replacements.get(value, value) if isinstance(value, str) else value


def replay_scene(game, self_id, settings):
    if not isinstance(settings, dict) or not isinstance(settings.get('scene'), str):
        raise ValueError('Expected named replay scene')
    scene = settings['scene']
    allowed = {'scene'}
    if scene == 'table':
        allowed |= {'street', 'opponent', 'table', 'part'} if game == 'texas' else {'opponent', 'seen'}
    elif scene in FILES:
        allowed.add('file')
        if settings.get('file') not in FILES[scene]:
            raise ValueError('Unknown animation asset')
    elif scene == 'player-action':
        allowed.add('action')
        if settings.get('action') not in ('call', 'raise', 'check', 'fold'):
            raise ValueError('Unknown player action')
    if settings.keys() - allowed:
        raise ValueError('Unknown scene parameters')
    if scene == 'table' or (game == 'zhajinhua' and scene == 'room-status'):
        queue = texas_table(self_id, settings) if game == 'texas' else zhajinhua_table(self_id, settings)
        if scene == 'room-status':
            queue = queue[:1]
        data = {'stream': 'texas_holdem' if game == 'texas' else game, 'queue': queue}
    else:
        if scene not in EVENTS[game]:
            raise ValueError('Unknown replay scene')
        data = substitute(EVENTS[game][scene], {'$self': self_id, '$file': settings.get('file'),
                                               '$action': settings.get('action')})
    if 'queue' in data:
        data['sent_at'] = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return data
