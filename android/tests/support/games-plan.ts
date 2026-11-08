import type { VisualScenario } from '../../../visual/scenarioTypes';

export type GamePart = 'all' | 'first' | 'middle' | 'second' | 'table' | 'effects' | 'profiles';
const englishParts: Record<string, GamePart[]> = {
  signed_in_texas_game: ['table', 'effects', 'profiles'],
  signed_in_zhajinhua_game: ['table', 'effects'],
  signed_in_texas_pre_game: ['first', 'middle', 'second'],
  signed_in_zhajinhua_pre_game: ['first', 'second'],
};

/** 英文长场景按既有房间边界拆分，其他语言保留完整流程。
 * @param scenario - 共用场景。
 * @param locale - 当前语言。
 */
export function gameParts(scenario: VisualScenario, locale: string): GamePart[] {
  if (locale !== 'en') return ['all'];
  return englishParts[scenario.pageLabel] || ['all'];
}

/** 明确记录每个阶段的状态区间，截图顺序与共享清单一致。
 * @param scenario - 共用场景。
 * @param part - 当前阶段。
 */
export function gameStates(scenario: VisualScenario, part: GamePart): string[] {
  const ranges: Record<GamePart, [number, number?]> = {
    all: [0], first: [0, firstEnd(scenario)], middle: [3, 7], second: [7],
    table: [0, tableEnd(scenario)], effects: [0, 0], profiles: [10],
  };
  return scenario.snapshotStates!.slice(...ranges[part]);
}

/** 开局首段保留德州三个状态、拼三张七个状态。
 * @param scenario - 共用场景。
 */
function firstEnd(scenario: VisualScenario): number { return scenario.pageLabel === 'signed_in_texas_pre_game' ? 3 : 7; }

/** 德州资料在第十个状态后；拼三张牌桌包含全部状态。
 * @param scenario - 共用场景。
 */
function tableEnd(scenario: VisualScenario): number | undefined { return scenario.pageLabel === 'signed_in_texas_game' ? 10 : undefined; }

/** 保持既有报告名称。
 * @param scenario - 共用场景。
 * @param part - 当前阶段。
 */
export function gameLabel(scenario: VisualScenario, part: GamePart): string {
  return part === 'all' ? scenario.pageLabel : `${scenario.pageLabel}_${part}`;
}

/** 开局面板只在英文场景验证真实动画。
 * @param scenario - 共用场景。
 * @param locale - 当前语言。
 */
export function panelAnimation(scenario: VisualScenario, locale: string): boolean {
  return locale === 'en' && scenario.pageLabel.endsWith('_pre_game');
}

/** 保留英文牌桌与专项面板的系统动画选择。
 * @param scenario - 共用场景。
 * @param locale - 当前语言。
 */
export function gameAnimation(scenario: VisualScenario, locale: string): boolean {
  if (locale !== 'en') return false;
  return scenario.pageLabel.endsWith('_game') || ['signed_in_texas_hall', 'signed_in_texas_panels',
    'signed_in_texas_panel_variants'].includes(scenario.pageLabel);
}

/** 原有两类动画使用同一个固定原生驱动。
 * @param scenario - 共用场景。
 * @param locale - 当前语言。
 */
export function gameLaunchOptions(scenario: VisualScenario, locale: string): { gameDriver: boolean; enableSystemAnimations: boolean } {
  return { gameDriver: true, enableSystemAnimations: panelAnimation(scenario, locale) || gameAnimation(scenario, locale) };
}
