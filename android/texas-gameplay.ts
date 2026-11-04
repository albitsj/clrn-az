import type { TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { gameReady } from './game-controls';
import { captureGameFeedback } from './game-feedback';
import { gameReplaySender } from './game-replay';
import { texasGameplayProfiles } from './texas-gameplay-profiles';
import { texasRestore, type TexasRestore } from './texas-gameplay-restore';
import { texasGameplayTable } from './texas-gameplay-table';
import type { TexasContext } from './texas-support';
import { expectTexasBalance } from './texas-support';

/** 按原有房间阶段运行德州场景，每个阶段仍使用本轮真实代理。
 * @param device - 专用模拟器连接。
 * @param proxy - 本轮独占代理。
 * @param roomId - 新建的房间。
 * @param self - 登录用户。
 * @param capture - 共享状态截图。
 * @param animationInfo - 英文动画报告。
 * @param phase - 当前房间阶段。
 */
export async function texasGameplay(device: AndroidDevice, proxy: Mitmproxy, roomId: string,
  self: string, capture: TexasContext['capture'], animationInfo?: TestInfo,
  phase: 'all' | 'table' | 'effects' | 'profiles' = 'all'): Promise<void> {
  const context = { device, proxy, room: roomId, self, capture, animationInfo };
  await phases[phase](context, texasRestore(context));
}

const phases = {
  all: /** 顺序执行当前阶段所需的牌桌、效果及资料流程。
   * @param context - 本轮真实房间。
   * @param restore - 同一房间的牌桌恢复入口。
   */
    async (context: TexasContext, restore: TexasRestore) => {
      await texasGameplayTable(context, restore);
      await texasGameplayEffects(context);
      await texasGameplayProfiles(context);
    },
  table: texasGameplayTable,
  effects: /** 顺序执行当前阶段所需的牌桌、效果及资料流程。
   * @param context - 本轮真实房间。
   * @param restore - 同一房间的牌桌恢复入口。
   */
    async (context: TexasContext, restore: TexasRestore) => {
      await prepareSettlement(context, restore);
      await texasGameplayEffects(context);
      await assertReplayed(context);
    },
  profiles: /** 顺序执行当前阶段所需的牌桌、效果及资料流程。
   * @param context - 本轮真实房间。
   * @param restore - 同一房间的牌桌恢复入口。
   */
    async (context: TexasContext, restore: TexasRestore) => {
      await prepareSettlement(context, restore);
      await texasGameplayProfiles(context);
    },
};

/** 新房间重建已审查结算画面，供效果或资料阶段使用。
 * @param context - 当前真实房间、设备及报告。
 * @param restore - 恢复指定街的真实牌桌。
 */
export async function prepareSettlement(context: TexasContext, restore: TexasRestore): Promise<void> {
  const { device } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  const allIn = { scene: 'all-in' };
  const showdown = { scene: 'showdown' };
  const settlement = { scene: 'settlement' };
  // 新房间重建已审查结算画面，再独立验证道具、表情和玩家资料。
  await restore('river', true);
  await send(allIn);
  await gameReady(device, 'texas-holdem-player-action-all_in');
  await new Promise(resolve => setTimeout(resolve, 1600));
  await send(showdown);
  await new Promise(resolve => setTimeout(resolve, 1600));
  await send(settlement);
  await expectTexasBalance(context, '1180');
}

/** 保留每种贴纸和道具的原生播放验证。
 * @param context - 当前真实房间、设备及报告。
 */
export async function texasGameplayEffects(context: TexasContext): Promise<void> {
  const { device, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  if (!animationInfo) return;
  // 牌桌的 WebP 清单已经逐字节校验；这里还验证每种效果确实由房间消息在原生画面播放。
  await new Promise(resolve => setTimeout(resolve, 3000));
  await captureGameFeedback(device, 'texas', animationInfo!, send);
}

/** 反馈阶段结束时仍检查真实回放计数。
 * @param context - 当前真实房间。
 */
async function assertReplayed(context: TexasContext): Promise<void> {
  expect((await context.proxy.command<{ replayedMessages: number }>('status')).replayedMessages).toBeGreaterThan(0);
}
