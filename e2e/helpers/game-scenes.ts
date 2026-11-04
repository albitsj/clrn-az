/** 固定虚拟对手标识，仅供界面断言定位；网络消息在 Python 内生成。 */
export const REPLAY_PLAYER_IDS = [1, 2, 3, 4].map(index =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type TableOptions = 'standard' | 'observer' | 'full' | 'full-pots' | 'check'
  | 'all-in-only' | 'all-in-call' | 'shortcut-blinds' | 'shortcut-disabled';

/**
 * 选择 Python 牌桌场景，不构造游戏协议响应。
 * @param street - 需要展示的街。
 * @param opponent - 是否轮到对手。
 * @param table - 登记的桌面布局或操作分支。
 * @param part - 发牌动画分两次选择状态和手牌，保持原有采样时序。
 */
export function restoreTable(street: Street = 'preflop', opponent = false,
  table: TableOptions = 'standard', part: 'all' | 'without-hand' | 'hand' = 'all') {
  return { scene: 'table', street, opponent, table, part };
}
