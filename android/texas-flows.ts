import { gamePreGame } from './game-pregame';
import { texasControlVariants } from './texas-control-variants';
import { texasGameplay } from './texas-gameplay';
import { texasHall, texasHallVariants } from './texas-hall';
import { texasPanelVariants } from './texas-panel-variants';
import { texasPanels } from './texas-panels';
import { texasOptionalPreGame, texasRecordVariants } from './texas-record-variants';
import type { TexasContext } from './texas-support';
import { texasTableVariants } from './texas-table-variants';

const flows: Record<string, (context: TexasContext, phase?: GameplayPhase) => Promise<void>> = {
  signed_in_texas_pre_game: /** 在当前房间执行对应的共用场景。
   * @param context - 本轮真实房间。
   */
    async context => gamePreGame(context.device, 'texas-holdem', context.capture),
  signed_in_texas_game: /** 按房间阶段执行完整德州玩法。
   * @param context - 本轮真实房间。
   * @param phase - 当前阶段。
   */
    async (context, phase) => texasGameplay(context.device, context.proxy, context.room, context.self,
      context.capture, context.animationInfo, phase),
  signed_in_texas_optional_pre_game: texasOptionalPreGame,
  signed_in_texas_controls: texasControlVariants,
  signed_in_texas_table_states: texasTableVariants,
  signed_in_texas_records_v2: texasRecordVariants,
  signed_in_texas_panels: texasPanels,
  signed_in_texas_panel_variants: texasPanelVariants,
  signed_in_texas_hall: texasHall,
  signed_in_texas_hall_variants: texasHallVariants,
};
export const texasScenarioLabels = Object.keys(flows);
type GameplayPhase = 'all' | 'table' | 'effects' | 'profiles';

/**
 * 显式分派全部 Web 德州场景；新增 Web 场景没有适配时必须失败。
 * @param label - 共用场景名。
 * @param context - 当前真实房间及原生操作上下文。
 * @param phase - 英文对局按牌桌、效果与资料拆分后的执行部分。
 */
export async function runTexasScenario(label: string, context: TexasContext,
  phase: 'all' | 'table' | 'effects' | 'profiles' = 'all'): Promise<void> {
  if (!flows[label]) throw new Error(`缺少 Android 德州场景实现：${label}`);
  await flows[label](context, phase);
}
