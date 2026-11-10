"""在真实房间连接上回放德州消息，禁止把夹具操作发送到游戏服务。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '_shared' / 'mitmproxy'))
from replay_games import (  # noqa: E402
    TexasReplay as TexasReplay, TEXAS_PLAYER_IDS, TABLE_PLAYER_IDS as TABLE_PLAYER_IDS,
    UUID as UUID, valid_uuid as valid_uuid, ctx as ctx,
)

PLAYER_IDS = TEXAS_PLAYER_IDS
