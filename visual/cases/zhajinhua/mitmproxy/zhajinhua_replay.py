"""在真实房间连接上回放拼三张消息，禁止把夹具操作发送到游戏服务。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '_shared' / 'mitmproxy'))
from replay_games import (  # noqa: E402
    ZhajinhuaReplay as ZhajinhuaReplay, ZHAJINHUA_PLAYER_IDS, UUID as UUID, ctx as ctx,
)

PLAYER_IDS = ZHAJINHUA_PLAYER_IDS
