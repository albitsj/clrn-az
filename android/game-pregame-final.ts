import { setTimeout } from 'node:timers/promises';
import { captureNativeTransition } from './animation-transition';
import { adb } from './device';
import { gameConnected, gameGone, gameReady, gameTap as tap } from './game-controls';
import { animateGamePanel } from './game-panel-animation';
import { captureChatExitWithDiagnostics } from './game-chat-exit-diagnostics';

import type { PreGameContext } from './game-pregame-context';
import { captureGameThemes, closeAnimatedGameMask } from './game-pregame-helpers';

/** 排行榜、战绩、聊天及带入申请保持顺序和清理。
 * @param context - 当前玩法、设备和报告。
 */
export async function preGameFinal(context: PreGameContext): Promise<void> {
  const { device, game, capture, animationInfo } = context;
  await animateGamePanel(device, game, 'leaderboard',
    game === 'texas-holdem' ? 'texas-holdem-leaderboard-button' : 'zhajinhua-learder-borard-button',
    { x: 110, y: 400, width: 470, height: 450 }, animationInfo);
  await gameReady(device, 'public-leader-board-empty');
  await gameGone(device, 'public-leader-board-loading');
  await capture('leaderboard');
  await closeAnimatedGameMask(device, game, 'leaderboard', 'public-leader-board-container',
    { x: 110, y: 400, width: 470, height: 450 }, animationInfo);
  await openGameRecord(context);
  await gameReady(device, 'review-board-description-text');
  await capture('game_record');
  await closeGameRecord(context);
  await animateGamePanel(device, game, 'chat', `${game}-chat-button`,
    { x: 110, y: 860, width: 140, height: 310 }, animationInfo, 'enter', 'videoFrames');
  await gameReady(device, 'in-game-chat-container');
  await capture('chat');
  const chat = (await gameReady(device, 'in-game-chat-mask')).bounds;
  /** 点击聊天抽屉外的真实遮罩。 */
  const closeChat = () => adb('shell', 'input', 'tap', String(Math.round(chat.x + 8)),
    String(Math.round(chat.y + 80)));
  await closeChatDrawer(context, closeChat);
  await captureApplications(context);
  if (game === 'texas-holdem') return;
  await captureGameThemes(device, capture);
}

/** 仅缺少合格中途帧时关闭真实侧栏再采样。
 * @param context - 当前玩法、设备和报告。
 */
export async function openGameRecord(context: PreGameContext): Promise<void> {
  const { device, game, animationInfo } = context;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await animateGamePanel(device, game, 'game-record', 'game-record-button',
        { x: 150, y: 400, width: 440, height: 450 }, animationInfo, 'enter', 'videoFrames', [],
        async () => { await gameReady(device, 'review-board-description-text'); });
      break;
    } catch (error) {
      // 短侧滑偶尔整段落在录屏的两帧之间；只在缺少合格中途帧时关闭真实侧栏并重采。
      assertAnimationRetry(attempt, error, '动画中途帧的实际画面须接近已审查轨迹');
      const retryMask = (await gameReady(device, 'screen-mask-touch-to-close')).bounds;
      adb('shell', 'input', 'tap', String(Math.round(retryMask.x + 8)), String(Math.round(retryMask.y + 80)));
      await gameGone(device, 'screen-mask-touch-to-close');
      await setTimeout(1_000);
      await gameConnected(device, 2_000);
    }
  }
}

/** 聊天退场只对缺失中途采样重新触发真实抽屉。
 * @param context - 当前玩法、设备和报告。
 * @param closeChat - 点击真实聊天遮罩。
 */
export async function closeChatDrawer(context: PreGameContext, closeChat: () => void): Promise<void> {
  const { device, animationInfo } = context;
  if (animationInfo) await captureChatExit(context, closeChat);
  else closeChat();
  await gameGone(device, 'in-game-chat-container');
}

/** 退场采样保留原有三次上限及精确错误条件。
 * @param context - 当前房间。
 * @param closeChat - 点击真实遮罩。
 */
async function captureChatExit(context: PreGameContext, closeChat: () => void): Promise<void> {
  const { device, game } = context;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await captureChatExitWithDiagnostics(context, closeChat);
      break;
    } catch (error) {
      // 模拟器录屏偶尔在 300ms 退场期间重复上一帧；只对缺失中途采样重新触发真实抽屉。
      assertAnimationRetry(attempt, error, '必须采到起点和终点之间的真实动画帧');
      await gameGone(device, 'in-game-chat-container');
      await tap(device, `${game}-chat-button`);
      await gameReady(device, 'in-game-chat-container');
    }
  }
}

/** 保留三次上限及精确错误条件。
 * @param attempt - 当前采样序号。
 * @param error - 原始错误。
 * @param message - 允许重采的明确错误。
 */
function assertAnimationRetry(attempt: number, error: unknown, message: string): void {
  if (attempt === 2 || !String(error).includes(message)) throw error;
}

/** 点击侧栏外真实遮罩，保留战绩侧滑退场的采样方式。
 * @param context - 当前真实房间。
 */
async function closeGameRecord(context: PreGameContext): Promise<void> {
  const { device, game, animationInfo } = context;
  // 战绩从右侧展开；说明文字只占面板中间，不能用其边界判断遮罩位置。
  const reviewMask = (await gameReady(device, 'screen-mask-touch-to-close')).bounds;
  /** 点击侧栏外的遮罩，触发真实侧滑退出。 */
  const closeRecord = () => adb('shell', 'input', 'tap', String(Math.round(reviewMask.x + 8)),
    String(Math.round(reviewMask.y + 80)));
  if (animationInfo) await captureNativeTransition(device, `${game}-game-record-exit`, animationInfo,
    { x: 150, y: 400, width: 440, height: 450 }, closeRecord, [], [], 0,
    game === 'zhajinhua' ? 'videoFrames' : 'motionFrames');
  else closeRecord();
  await gameGone(device, 'review-board-description-text');
}

/** 聊天退场后先恢复稳定连接，再采集带入申请面板。
 * @param context - 当前真实房间。
 */
async function captureApplications(context: PreGameContext): Promise<void> {
  const { device, game, capture, animationInfo } = context;
  // 聊天抽屉退场后房间偶尔独立重连；下一段动画的起点必须是无遮挡的真实牌桌。
  await gameConnected(device, 2_000);
  await animateGamePanel(device, game, 'buy-in-applications', 'buy-in-application-button',
    { x: 110, y: 400, width: 470, height: 450 }, animationInfo, 'enter',
    game === 'zhajinhua' ? 'videoFrames' : 'motionFrames', [], undefined,
    game === 'zhajinhua' ? ['zhajinhua-buy-in-applications-enter-middle-alternate.png'] : []);
  await gameReady(device, 'buy-in-application-no-requests');
  await capture('buy_in_applications');
  await closeAnimatedGameMask(device, game, 'buy-in-applications', 'buy-in-application-list',
    { x: 110, y: 400, width: 470, height: 450 }, animationInfo);
}
