import { expect } from '@playwright/test';
import { setTimeout } from 'node:timers/promises';
import { gameGone, gameNodes, gameReady, gameTap as tap } from './game-controls';
import { animateGamePanel } from './game-panel-animation';
import { captureMovingKeyframes } from './loop-keyframes';

import { captureConnected } from './game-capture-retry';
import type { PreGameContext } from './game-pregame-context';
import { closeAnimatedGameMask } from './game-pregame-helpers';

/** 初始牌桌、菜单和牌型说明。
 * @param context - 当前玩法、设备和报告。
 */
export async function preGameOpening(context: PreGameContext): Promise<void> {
  const { device, game, capture, animationInfo } = context;
  await capture('waiting_table');
  await captureSeatGuides(context);
  await openDrawer(context);
  await gameReady(device, 'drawer-menu-item-exit');
  await capture('menu');
  await animateGamePanel(device, game, 'card-rank', 'drawer-menu-item-card_rank',
    { x: 110, y: 400, width: 440, height: 600 }, animationInfo, 'enter', 'videoFrames');
  await gameReady(device, 'card-rank-list');
  await captureConnected(device, capture, 'card_rank');
  await closeCardRank(context);
  await preGameRule(context);
}

/** 拼三张九个空座箭头必须分别采到运动。
 * @param context - 当前玩法、设备和报告。
 */
export async function captureSeatGuides(context: PreGameContext): Promise<void> {
  const { device, game, animationInfo } = context;
  if (game === 'zhajinhua' && animationInfo) {
    const arrows = (await gameNodes(device)).filter(node => seatGuide(node));
    expect(arrows, '九个空座箭头必须分别可见').toHaveLength(9);
    await captureMovingKeyframes(device, 'zhajinhua-seat-guides', animationInfo,
      arrows.map(node => node.bounds));
  }
}

/** 保持两种玩法各自审查的菜单动画相位。
 * @param context - 当前玩法、设备和报告。
 */
export async function openDrawer(context: PreGameContext): Promise<void> {
  const { device, game, animationInfo } = context;
  await animateGamePanel(device, game, 'drawer-menu', 'menu-button',
    { x: 120, y: 300, width: 180, height: 500 }, animationInfo, 'enter',
    game === 'zhajinhua' ? 'videoFrames' : 'motionFrames', [], undefined,
    game === 'texas-holdem' ? [
      'texas-holdem-drawer-menu-enter-early-phase.png',
      'texas-holdem-drawer-menu-enter-late-phase.png',
    ] : []);
}

/** 优先真实关闭按钮，缺少时点击真实遮罩。
 * @param context - 当前玩法、设备和报告。
 */
export async function closeCardRank(context: PreGameContext): Promise<void> {
  const { device, game, animationInfo } = context;
  if ((await gameNodes(device)).some(node => node.res === 'card-rank-popup-close')) {
    await animateGamePanel(device, game, 'card-rank', 'card-rank-popup-close',
      { x: 110, y: 400, width: 440, height: 600 }, animationInfo, 'exit', 'videoFrames', [], undefined,
      game === 'texas-holdem' ? ['texas-holdem-card-rank-exit-late-phase.png'] : []);
  }
  else await closeAnimatedGameMask(device, game, 'card-rank', 'card-rank-list',
    { x: 110, y: 400, width: 440, height: 600 }, animationInfo);
}

/** 拼三张规则弹窗保留重连消失等待。
 * @param context - 当前玩法、设备和报告。
 */
export async function preGameRule(context: PreGameContext): Promise<void> {
  const { device, game, animationInfo } = context;
  if (game === 'zhajinhua') {
    await tap(device, 'menu-button');
    await animateGamePanel(device, game, 'game-rule', 'drawer-menu-item-game_rule',
      { x: 130, y: 330, width: 460, height: 610 }, animationInfo);
    await gameReady(device, 'game-rule-popup');
    await animateGamePanel(device, game, 'game-rule', 'game-rule-popup-close-button',
      { x: 130, y: 330, width: 460, height: 610 }, animationInfo, 'exit', 'videoFrames', [], async () => {
        // 背景房间连接提示可能在面板退场后出现；终点须等它确实消失。
        await setTimeout(1_000);
        await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
          { timeout: 30_000 }).toBe(false);
      });
    await gameGone(device, 'game-rule-popup');
  }
}

/** 按共用顺序采集主题、设置、买入和续费。
 * @param context - 当前玩法、设备和报告。
 */
export async function preGamePanels(context: PreGameContext): Promise<void> {
  for (const [state, ready, close] of [
    ['theme', 'game-settings-card-theme-simple', 'game-settings-close-button'],
    ['settings', 'game-settings-popup-container', 'game-settings-close-button'],
    ['buy_in', 'texas-holdem-buy-in-popup-visible-marker', 'buy-in-close-button'],
    ['renew', 'renew-popup-close-button', 'renew-popup-close-button'],
  ] as const) {
    await capturePreGamePanel(context, state, ready, close);

  }
  await preGameLeaderboardStart(context);
}

/** 续费结束后为排行榜等待稳定起点。
 * @param context - 当前玩法、设备和报告。
 */
export async function preGameLeaderboardStart(context: PreGameContext): Promise<void> {
  const { device, game } = context;
  if (game === 'zhajinhua') {
    // 续费面板结束后房间可能独立重连；排行榜起点必须是稳定牌桌。
    await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
      { timeout: 45_000 }).toBe(false);
    await setTimeout(1_000);
    await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
      { timeout: 45_000 }).toBe(false);
  }
}

import { capturePreGamePanel } from './game-pregame-panels';

export { preGameFinal } from './game-pregame-final';

/** 可见座位箭头必须具有正面积。
 * @param node - 当前原生节点。
 */
function seatGuide(node: import('./game-controls').NativeNode): boolean {
  return String(node.res).startsWith('seat-guide-') && positiveGuide(node.bounds);
}

/** 排除原生裁剪为零面积的箭头。
 * @param bounds - 实际箭头边界。
 */
function positiveGuide(bounds: import('./screenshot').ScreenshotBounds): boolean {
  return bounds.width > 0 && bounds.height > 0;
}
