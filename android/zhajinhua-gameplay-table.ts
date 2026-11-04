import { expect } from '@playwright/test';
import { PLAYER_IDS, restoreTable } from '../e2e/helpers/zhajinhua-scenes';
import { captureNativeTransition } from './animation-transition';
import { adb } from './device';
import { gameGone, gameNodes, gameReady, gameTap } from './game-controls';
import { animateGamePanel } from './game-panel-animation';
import { closeAnimatedGameMask } from './game-pregame';
import { gameCardNames, gameReplaySender } from './game-replay';
import { captureConcurrentMotion, captureLoopKeyframes, captureMovingKeyframes } from './loop-keyframes';
import { expectZhajinhuaBalance, type ZhajinhuaContext } from './zhajinhua-gameplay-support';

/** 逐一执行八个原生牌桌状态。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function zhajinhuaTable(context: ZhajinhuaContext): Promise<void> {
  await captureBlindCards(context);
  await captureSeenCards(context);
  await captureQuickRaise(context);
  await captureAccurateRaise(context);
  await captureChallenge(context);
  await captureOpponentAndSettlement(context);
}

/** 先恢复真实牌桌，再验证暗牌和操作入口。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function captureBlindCards(context: ZhajinhuaContext): Promise<void> {
  const { device, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'zhajinhua', context.roomId);
  if (animationInfo) await captureNativeTransition(device, 'zhajinhua-deal-cards', animationInfo,
    { x: 360, y: 1054, width: 148, height: 102 }, () => send(restoreTable()),
    [], [], 0, 'videoFrames');
  else await send(restoreTable());
  await expect.poll(async () => (await gameNodes(device))
    .filter(node => node.res?.startsWith('zhajinhua-player-container-')).length, { timeout: 30_000 }).toBe(5);
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'player_card').length,
    { timeout: 30_000 }).toBe(15);
  await send({ scene: 'room-status' });
  await gameGone(device, 'player_tips_text');
  await gameReady(device, 'zhajinhua-operation-button-call');
  await gameReady(device, 'zhajinhua-see-hand-card-button');
  await captureOwnCountdown(context);
  await capture('blind_cards');
}

/** 本人倒计时必须可见并实际运动。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function captureOwnCountdown(context: ZhajinhuaContext): Promise<void> {
  const { device, animationInfo } = context;
  if (animationInfo) {
    const timer = (await gameNodes(device)).find(node => node.res === 'zhajinhua-active-countdown');
    expect(timer, '拼三张本人操作倒计时必须可见').toBeDefined();
    await captureMovingKeyframes(device, 'zhajinhua-operation-countdown', animationInfo, [timer!.bounds]);
  }
}

/** 真实点击看牌并经房间消息翻开本人三张牌。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function captureSeenCards(context: ZhajinhuaContext): Promise<void> {
  const { device, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'zhajinhua', context.roomId);
  const seeCards = { scene: 'see-cards' };
  if (animationInfo) {
    const see = await gameReady(device, 'zhajinhua-see-hand-card-button');
    /** 点击真实看牌按钮并通过原生牌局消息翻开本人三张牌。 */
    const revealCards = async () => {
      adb('shell', 'input', 'tap', String(Math.round(see.bounds.x + see.bounds.width / 2)),
        String(Math.round(see.bounds.y + see.bounds.height / 2)));
      await send(seeCards);
    };
    await captureNativeTransition(device, 'zhajinhua-flip-cards', animationInfo,
      { x: 360, y: 1054, width: 148, height: 102 }, revealCards, [], [], 800, 'videoFrames');
  } else {
    await gameTap(device, 'zhajinhua-see-hand-card-button');
    await send(seeCards);
  }
  // 其余四位玩家的十二张暗牌没有牌名；与 Web 相同，只校验已翻开的三张牌。
  await gameCardNames(device, 'player_card', 'player_card_name_text', ['as', 'ad', 'ac'], { namedOnly: true });
  await gameGone(device, 'zhajinhua-see-hand-card-button');
  await capture('seen_cards', [{
    x: 260, y: 1075, width: 35, height: 40,
    reason: '看牌后玩家头像下的独立操作秒数仍在跳动'
  }]);
}

/** 真实快捷加注后核对本人余额。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function captureQuickRaise(context: ZhajinhuaContext): Promise<void> {
  const { device, self, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'zhajinhua', context.roomId);
  const raise = { scene: 'raise' };
  if (animationInfo) {
    const button = await gameReady(device, 'zhajinhua-shortcut-raise-first');
    /** 通过真实按钮和回放消息触发加注筹码动画。 */
    const pressRaise = async () => {
      adb('shell', 'input', 'tap', String(Math.round(button.bounds.x + button.bounds.width / 2)),
        String(Math.round(button.bounds.y + button.bounds.height / 2)));
      await send(raise);
    };
    await captureNativeTransition(device, 'zhajinhua-quick-raise', animationInfo,
      { x: 340, y: 790, width: 170, height: 270 }, pressRaise, [], [], 1200);
  } else {
    await gameTap(device, 'zhajinhua-shortcut-raise-first');
    await send(raise);
  }
  await gameReady(device, `zhajinhua-player-container-${self}`);
  await expectZhajinhuaBalance(context, '960');
  await capture('quick_raise');
}

/** 精确加注保留已审查的进退场采样和独立倒计时遮罩。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function captureAccurateRaise(context: ZhajinhuaContext): Promise<void> {
  const { device, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'zhajinhua', context.roomId);
  if (animationInfo) await captureNativeTransition(device, 'zhajinhua-operation-buttons', animationInfo,
    // 下方三张手牌独立重绘；只比较操作按钮及文字。
    { x: 100, y: 865, width: 520, height: 180 }, () => send(restoreTable(false, true)),
    [], [], 400, 'videoFrames');
  else await send(restoreTable(false, true));
  await gameReady(device, 'zhajinhua-operation-accurate-bet-button');
  const accurateBetClock = [{
    x: 350, y: 725, width: 90, height: 40,
    reason: '独立运行的玩家操作倒计时，不属于精确加注弹窗'
  }];
  await animateGamePanel(device, 'zhajinhua', 'accurate-bet', 'zhajinhua-operation-accurate-bet-button',
    { x: 150, y: 400, width: 430, height: 480 }, animationInfo, 'enter', 'videoFrames', accurateBetClock,
    async () => { await gameReady(device, 'accurate-bet-popup-container'); });
  await gameReady(device, 'accurate-bet-popup-container');
  await capture('accurate_raise');
  await closeAnimatedGameMask(device, 'zhajinhua', 'accurate-bet',
    'accurate-bet-popup-container', { x: 150, y: 400, width: 430, height: 480 }, animationInfo,
    accurateBetClock, 'videoFrames', ['zhajinhua-accurate-bet-exit-middle-contracted.png']);
}

/** 比牌选择态继续验证四个目标及循环动画。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function captureChallenge(context: ZhajinhuaContext): Promise<void> {
  const { device, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'zhajinhua', context.roomId);
  if (animationInfo) {
    // 原生录屏与关键帧采集可能耗尽上一轮操作时限；恢复相同牌桌后再检查比牌选择态。
    await send(restoreTable(false, true));
    await gameReady(device, 'zhajinhua-voice-button');
  }
  await gameTap(device, 'zhajinhua-operation-button-battle');
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'challenge_player_selector').length,
    { timeout: 30_000 }).toBe(4);
  if (animationInfo) {
    const selectors = (await gameNodes(device)).filter(node => node.res === 'challenge_player_selector');
    await captureLoopKeyframes(device, 'zhajinhua-challenge-targets', animationInfo,
      // 控件树给出头像的点击框；闪烁绿色边框绘制在其上下各约 40 像素之外。
      selectors.map(node => ({
        x: node.bounds.x - 14, y: node.bounds.y - 42,
        width: node.bounds.width + 28, height: node.bounds.height + 84
      })), 3);
  }
  await capture('challenge_select');
}

/** 保持对手回合、摊牌及结算的业务断言。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function captureOpponentAndSettlement(context: ZhajinhuaContext): Promise<void> {
  const { device, capture, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'zhajinhua', context.roomId);
  const showdown = { scene: 'showdown' };
  const settlement = { scene: 'settlement' };
  await gameTap(device, 'zhajinhua-cancel-challenge-choosing');
  await gameTap(device, 'zhajinhua-shortcut-raise-first');
  await send(restoreTable(true, true));
  await gameReady(device, `zhajinhua-player-container-${PLAYER_IDS[0]}-operating`);
  await gameGone(device, 'zhajinhua-operation-button-call');
  await capture('opponent_turn');
  if (animationInfo) await captureNativeTransition(device, 'zhajinhua-showdown-cards', animationInfo,
    { x: 8, y: 697, width: 170, height: 102 }, () => send(showdown),
    [{
      x: 82, y: 697, width: 52, height: 75,
      reason: '摊牌前独立运行的对手操作倒计时，遮住右上角数字和圆环'
    }],
    [{ x: 235, y: 960, width: 140, height: 110 }], 800, 'motionFrames',
    frames => captureConcurrentMotion(frames, 'zhajinhua-victory', animationInfo,
      { x: 235, y: 960, width: 140, height: 110 }));
  else await send(showdown);
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'player_cards_container').length,
    { timeout: 30_000 }).toBe(2);
  await capture('showdown');
  await send(settlement);
  // 与德州一样，摊牌后的牌型会覆盖余额；从当前可见玩家读取明确的余额语义标记。
  await expectZhajinhuaBalance(context, '1120');
  await capture('settlement');
}
