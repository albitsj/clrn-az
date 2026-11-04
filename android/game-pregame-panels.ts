import { expect } from '@playwright/test';
import presentation from '../visual/fixtures/account-presentation.json';
import { gameGone, gameNodes, gameReady, gameTap as tap } from './game-controls';
import { animateGamePanel } from './game-panel-animation';

import { captureConnected } from './game-capture-retry';
import type { PreGameContext } from './game-pregame-context';
type PanelState = 'theme' | 'settings' | 'buy_in' | 'renew';

/** 逐个弹窗保留业务就绪条件及进退场采样。
 * @param context - 当前玩法、设备和报告。
 * @param state - 共用面板状态。
 * @param ready - 业务就绪标记。
 * @param close - 真实关闭按钮。
 */
export async function capturePreGamePanel(context: PreGameContext, state: PanelState, ready: string, close: string): Promise<void> {
  const { device, game, capture, animationInfo } = context;
  // 重连遮罩会短暂盖住菜单按钮；等真实牌桌恢复后再点击下一项。
  await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
    { timeout: 45_000 }).toBe(false);
  await tap(device, 'menu-button');
  await gameReady(device, `drawer-menu-item-${state}`);
  const renewalReady = renewalHook(context, state);
  await animateGamePanel(device, game, state, `drawer-menu-item-${state}`,
    { x: 110, y: 360, width: 480, height: 500 }, animationInfo, 'enter',
    panelMethods[game].enter[state], [], renewalReady,
    renewalAnchors(game, state));
  await gameGone(device, 'drawer-menu-item-exit');
  await gameReady(device, ready);
  await waitRenewal(context, state);
  await captureConnected(device, capture, state);
  const exitReady = exitHook(context, state);
  await animateGamePanel(device, game, state, close,
    { x: 110, y: 360, width: 480, height: 500 }, animationInfo, 'exit',
    panelMethods[game].exit[state], [], exitReady);
  await gameGone(device, ready);
}

const panelMethods = {
  'texas-holdem': {
    enter: { theme: 'videoFrames', settings: 'motionFrames', buy_in: 'videoFrames', renew: 'motionFrames' },
    exit: { theme: 'motionFrames', settings: 'videoFrames', buy_in: 'motionFrames', renew: 'motionFrames' },
  },
  zhajinhua: {
    enter: { theme: 'videoFrames', settings: 'videoFrames', buy_in: 'videoFrames', renew: 'videoFrames' },
    exit: { theme: 'videoFrames', settings: 'videoFrames', buy_in: 'videoFrames', renew: 'videoFrames' },
  },
} as const;

/** 续费入场固定经过菜单关闭的审查相位。
 * @param game - 当前玩法。
 * @param state - 当前面板。
 */
function renewalAnchors(game: string, state: string): string[] {
  return game === 'texas-holdem' && state === 'renew' ? ['texas-holdem-renew-enter-menu-closed-phase.png'] : [];
}

/** 英文续费动画须等真实余额和价格加载后固定终点。
 * @param context - 当前房间。
 * @param state - 当前面板。
 */
function renewalHook(context: PreGameContext, state: PanelState): (() => Promise<void>) | undefined {
  if (state !== 'renew' || !context.animationInfo) return undefined;
  return () => waitRenewal(context, state);
}

/** 关闭按钮先于业务数据出现，两个初始零不能作为就绪证据。
 * @param context - 当前房间。
 * @param state - 当前面板。
 */
async function waitRenewal(context: PreGameContext, state: PanelState): Promise<void> {
  if (state !== 'renew') return;
  const { device } = context;
  await expect.poll(async () => (await gameReady(device, 'renew-popup-remain-diamond')).text?.trim(),
    { timeout: 45_000 }).toBe(presentation.balance);
  await expect.poll(async () => Number((await gameReady(device, 'renew-popup-spend-diamond')).text?.trim()),
    { timeout: 45_000 }).toBeGreaterThan(0);
}

/** 拼三张买入退场的终点须等待独立重连遮罩消失。
 * @param context - 当前房间。
 * @param state - 当前面板。
 */
function exitHook(context: PreGameContext, state: PanelState): (() => Promise<void>) | undefined {
  if ([context.game !== 'zhajinhua', state !== 'buy_in', !context.animationInfo].some(Boolean)) return undefined;
  return async () => {
    await expect.poll(async () => (await gameNodes(context.device)).some(node => /Connecting\.\.\./.test(node.text || '')),
      { timeout: 45_000 }).toBe(false);
  };
}
