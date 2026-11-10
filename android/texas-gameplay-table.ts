import { expect } from '@playwright/test';
import { REPLAY_PLAYER_IDS, type Street } from '../e2e/helpers/game-scenes';
import { captureNativeTransition, captureTransientTransition } from './animation-transition';

import {
  flattenNodes, gameConnected,
  gameGone,
  gameNodes,
  gameReady,
  gameTap
} from './game-controls';
import { animateGamePanel } from './game-panel-animation';
import { closeAnimatedGameMask } from './game-pregame';
import { gameReplaySender } from './game-replay';
import { captureMovingKeyframes } from './loop-keyframes';
import { expectTexasBalance, playerActionRegion, waitForPlayerActionStart, type TexasContext } from './texas-support';

import type { TexasRestore } from './texas-gameplay-restore';

/** 逐街、加注、对手操作和结算按原顺序采集。
 * @param context - 当前真实房间、设备及报告。
 * @param restore - 恢复指定街的真实牌桌。
 */
export async function texasGameplayTable(context: TexasContext, restore: TexasRestore): Promise<void> {
  const { device, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
    await restore(street);
    await captureOwnCountdown(context, street);
    await capture(street);
  }
  await animateGamePanel(device, 'texas-holdem', 'raise-bet', 'texas-holdem-operation-button-raise',
    { x: 320, y: 245, width: 190, height: 430 }, animationInfo, 'enter', 'videoFrames');
  await gameReady(device, 'raise-bet-popup');
  await capture('raise');
  await captureRaiseSlider(context);
  await cancelRaise(context);
  await gameGone(device, 'raise-bet-popup');
  await animateGamePanel(device, 'texas-holdem', 'accurate-bet', 'texas-holdem-operation-accurate-bet-button',
    { x: 120, y: 360, width: 480, height: 330 }, animationInfo, 'enter', 'videoFrames');
  await gameReady(device, 'accurate-bet-popup-container');
  await capture('accurate_raise');
  await closeAnimatedGameMask(device, 'texas-holdem', 'accurate-bet',
    'accurate-bet-popup-container', { x: 120, y: 360, width: 480, height: 330 }, animationInfo,
    [], 'videoFrames');
  await restore('river', true);
  await captureOperationButtons(context, restore);
  await send({ scene: 'opponent-turn' });
  await gameGone(device, 'texas-holdem-operation-button-raise');
  await capture('opponent_turn');
  await capturePlayerActions(context, restore);
  await captureTableSettlement(context);
}

/** 起手牌保留本人操作倒计时的关键帧。
 * @param context - 当前真实房间、设备及报告。
 * @param street - 当前街。
 */
export async function captureOwnCountdown(context: TexasContext, street: Street): Promise<void> {
  const { device, animationInfo } = context;
  if (street === 'preflop' && animationInfo) {
    const timer = (await gameNodes(device)).find(node => node.res === 'texas-holdem-active-countdown');
    expect(timer, '德州本人操作倒计时必须可见').toBeDefined();
    await captureMovingKeyframes(device, 'texas-operation-countdown', animationInfo, [timer!.bounds]);
  }
}

/** 通过原生驱动完成拖动，90 个五毫秒步骤保持原 450ms 移动时长。
 * @param context - 当前真实房间、设备及报告。
 */
export async function captureRaiseSlider(context: TexasContext): Promise<void> {
  const { device, animationInfo } = context;
  if (animationInfo) {
    await gameReady(device, 'raise-bet-slider');
    const initialRaise = (await gameReady(device, 'raise-bet-display-text')).text;
    await captureNativeTransition(device, 'texas-raise-slider', animationInfo,
      { x: 285, y: 245, width: 295, height: 630 },
      () => device.input.drag({ x: 333, y: 814 }, { x: 333, y: 530 }, 90),
      [{
        x: 285, y: 725, width: 160, height: 35,
        reason: '加注滑块后面的牌局倒计时独立跳秒'
      }], [], 0, 'videoFrames',
      undefined, undefined, [],
      [{
        x: 120, y: 250, width: 160, height: 105,
        reason: '终点加注数字由拖动采样量化；完整标签保留在报告，数值另用原生文本断言'
      }]);
    expect((await gameReady(device, 'raise-bet-display-text')).text,
      '真实拖动必须改变加注数值').not.toBe(initialRaise);
  }
}

/** 真实取消加注保留三次关闭等待。
 * @param context - 当前真实房间、设备及报告。
 */
export async function cancelRaise(context: TexasContext): Promise<void> {
  const { device } = context;
  // 原生录屏确认取消按钮直接移除面板，没有可供回归的退场过渡帧。
  for (let attempt = 0; attempt < 3; attempt++) {
    await gameConnected(device);
    await gameTap(device, 'raise-bet-cancel-button');
    try {
      await expect.poll(async () => (await gameNodes(device)).some(node => node.res === 'raise-bet-popup'),
        { timeout: 10_000, intervals: [250] }).toBe(false);
      break;
    } catch (error) {
      assertCancelRetry(attempt, error);
    }
  }
}

/** 先等自动操作按钮入场，再单独采样本人按钮。
 * @param context - 当前真实房间、设备及报告。
 * @param restore - 恢复指定街的真实牌桌。
 */
export async function captureOperationButtons(context: TexasContext, restore: TexasRestore): Promise<void> {
  const { device, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  if (animationInfo) {
    await send({ scene: 'opponent-turn' });
    await gameGone(device, 'texas-holdem-operation-button-raise');
    await expect.poll(async () => (await gameNodes(device))
      .some(node => node.res?.startsWith('texas-holdem-auto-button-')), { timeout: 30_000 }).toBe(true);
    // 对手自动操作按钮先完成入场，再单独采样本人操作按钮。
    await new Promise(resolve => setTimeout(resolve, 1000));
    await captureNativeTransition(device, 'texas-operation-buttons', animationInfo,
      { x: 100, y: 865, width: 500, height: 150 }, () => send({ scene: 'own-turn' }), [], [], 400);
    await gameReady(device, 'texas-holdem-operation-button-raise');
    await restore('river', true);
  }
}

/** 四种动作在仍进行的牌局中分别触发。
 * @param context - 当前真实房间、设备及报告。
 * @param restore - 恢复指定街的真实牌桌。
 */
export async function capturePlayerActions(context: TexasContext, restore: TexasRestore): Promise<void> {
  const { device, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  if (animationInfo) {
    // 结算会销毁手牌引用；四种动作必须在仍进行的牌局中分别触发。
    const actionPlayer = REPLAY_PLAYER_IDS[1];
    for (const action of ['call', 'raise', 'check', 'fold'] as const) {
      await restore('river', true);
      await send({ scene: 'action-turn' });
      /** 从本轮指定玩家读取实际可见动作，忽略其他座位仍保留的操作标记。 */
      const playerAction = async () => {
        const player = (await gameNodes(device)).find(node => node.res?.startsWith(`texas-holdem-player-container-${actionPlayer}`));
        return player && flattenNodes(player).some(node => node.res === `texas-holdem-player-action-${action}`);
      };
      await expect.poll(playerAction, { timeout: 30_000 }).toBe(false);
      await gameReady(device, 'texas-holdem-active-countdown');
      await waitForPlayerActionStart(device, animationInfo, action);
      await captureNativeTransition(device, `texas-player-action-${action}`, animationInfo,
        // 动作标签右侧不与玩家头像倒计时重叠，可完整观察标签而无需遮罩。
        playerActionRegion,
        () => send({ scene: 'player-action', action }),
        [], [], 0, 'videoFrames');
      await expect.poll(playerAction, { timeout: 30_000 }).toBe(true);
    }
    await restore('river', true);
    await send({ scene: 'opponent-turn' });
    // 上一轮弃牌的标签退场和座位切换会继续绘制一小段时间；
    // 等它们结束后再取全压特效的第一帧，确保第一帧是稳定的起点。
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}

/** 依次验证全压、摊牌和结算。
 * @param context - 当前真实房间、设备及报告。
 */
export async function captureTableSettlement(context: TexasContext): Promise<void> {
  await captureAllIn(context);
  await captureShowdown(context);
  await captureSettlement(context);
}

/** 全压特效之后继续采集同一状态。
 * @param context - 当前真实房间、设备及报告。
 */
export async function captureAllIn(context: TexasContext): Promise<void> {
  const { device, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  const allIn = { scene: 'all-in' };
  if (animationInfo) await captureNativeTransition(device, 'texas-all-in-fire', animationInfo,
    { x: 0, y: 650, width: 250, height: 225 }, () => send(allIn),
    [{ x: 65, y: 695, width: 70, height: 90, reason: '全压特效旁的对手操作秒数独立跳秒' }], [], 1600);
  else await send(allIn);
  await gameReady(device, 'texas-holdem-player-action-all_in');
  await capture('all_in');
}

/** 摊牌终点仍等待真实重连提示消失。
 * @param context - 当前真实房间、设备及报告。
 */
export async function captureShowdown(context: TexasContext): Promise<void> {
  const { device, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  const showdown = { scene: 'showdown' };
  if (animationInfo) await captureNativeTransition(device, 'texas-showdown', animationInfo,
    { x: 0, y: 580, width: 600, height: 600 }, () => send(showdown),
    [{ x: 334, y: 720, width: 110, height: 47, reason: '摊牌旁的房间计时独立跳秒' }], [], 1600,
    'videoFrames', undefined, async () => {
      // 房间重连提示偶尔在录屏结束后盖住牌面，等稳定牌桌再校验终点。
      await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
        { timeout: 45_000 }).toBe(false);
    });
  else await send(showdown);
  await capture('showdown');
}

/** 结算金额从当前玩家语义节点读取。
 * @param context - 当前真实房间、设备及报告。
 */
export async function captureSettlement(context: TexasContext): Promise<void> {
  const { device, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  const settlement = { scene: 'settlement' };
  if (animationInfo) await captureTransientTransition(device, 'texas-settlement', animationInfo,
    { x: 150, y: 950, width: 390, height: 250 }, () => send(settlement), 1600);
  else await send(settlement);
  // 摊牌时余额被牌型标签替代；余额语义标记仍附在当前可见玩家容器内。
  await expectTexasBalance(context, '1180');
  await capture('settlement');
}

/** 取消加注的最后一次失败必须传播原始错误。
 * @param attempt - 当前尝试。
 * @param error - 原始错误。
 */
function assertCancelRetry(attempt: number, error: unknown): void { if (attempt === 2) throw error; }
