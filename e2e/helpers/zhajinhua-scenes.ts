export { REPLAY_PLAYER_IDS as PLAYER_IDS } from './game-scenes';

/**
 * 选择 Python 拼三张牌桌场景。
 * @param opponent - 是否轮到对手。
 * @param seen - 是否已看牌。
 */
export function restoreTable(opponent = false, seen = false) {
  return { scene: 'table', opponent, seen };
}
