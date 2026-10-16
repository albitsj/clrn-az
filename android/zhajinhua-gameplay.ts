import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { events, PLAYER_IDS, restoreTable, validBets } from '../visual/cases/zhajinhua/replayData';
import { gameReady, gameGone, gameTap, gameNodes, gameSemanticText } from './game-controls';
import { replay, gameCardNames } from './game-replay';
import { closeGameMask } from './game-pregame';
import { captureNativeTransition } from './animation-transition';
import { adb } from './device';
import { animateGamePanel } from './game-panel-animation';
import { captureLoopKeyframes, captureMovingKeyframes } from './loop-keyframes';
import { captureAssetSequence } from './asset-sequence';

/**
 * 直接使用 Web 八个牌局状态的网络事件，真实点击原生操作按钮。
 * @param device - 专用模拟器连接。
 * @param proxy - 本轮独占代理。
 * @param roomId - 本轮创建的房间。
 * @param self - 本轮真实登录用户。
 * @param capture - 使用共用状态名采集截图。
 * @param animationInfo - 英文原生发牌、翻牌和摊牌关键帧基准。
 */
export async function zhajinhuaGameplay(device: AndroidDevice, proxy: Mitmproxy, roomId: string,
  self: string, capture: (state: string) => Promise<void>, animationInfo?: TestInfo): Promise<void> {
  /**
   * 发送共用回放事件。
   * @param data - Web 共用的网络事件。
   */
  const send = (data: unknown) => replay(proxy, 'zhajinhua', roomId, data);
  if (animationInfo) await captureNativeTransition(device, 'zhajinhua-deal-cards', animationInfo,
    { x: 360, y: 1054, width: 148, height: 102 }, () => send(restoreTable(self)));
  else await send(restoreTable(self));
  await expect.poll(async () => (await gameNodes(device))
    .filter(node => node.res?.startsWith('zhajinhua-player-container-')).length, { timeout: 30_000 }).toBe(5);
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'player_card').length,
    { timeout: 30_000 }).toBe(15);
  await send(events([restoreTable(self).queue[0]]));
  await gameGone(device, 'player_tips_text');
  await gameReady(device, 'zhajinhua-operation-button-call');
  await gameReady(device, 'zhajinhua-see-hand-card-button');
  if (animationInfo) {
    const timer = (await gameNodes(device)).find(node => node.res === 'zhajinhua-active-countdown');
    expect(timer, '拼三张本人操作倒计时必须可见').toBeDefined();
    await captureMovingKeyframes(device, 'zhajinhua-operation-countdown', animationInfo, [timer!.bounds]);
  }
  await capture('blind_cards');
  const seeCards = events([
    { event: 'see_hole_card', player_id: self },
    { event: 'obtain_hole_card', hole_card: ['as', 'ad', 'ac'], hand_strength: 'three_of_a_kind' },
    { event: 'player_bets', valid_bets: validBets(true) },
  ]);
  if (animationInfo) {
    const see = await gameReady(device, 'zhajinhua-see-hand-card-button');
    /** 点击真实看牌按钮并通过原生牌局消息翻开本人三张牌。 */
    const revealCards = async () => {
      adb('shell', 'input', 'tap', String(Math.round(see.bounds.x + see.bounds.width / 2)),
        String(Math.round(see.bounds.y + see.bounds.height / 2)));
      await send(seeCards);
    };
    await captureNativeTransition(device, 'zhajinhua-flip-cards', animationInfo,
      { x: 360, y: 1054, width: 148, height: 102 }, revealCards, [], [], 800);
  } else {
    await gameTap(device, 'zhajinhua-see-hand-card-button');
    await send(seeCards);
  }
  // 其余四位玩家的十二张暗牌没有牌名；与 Web 相同，只校验已翻开的三张牌。
  await gameCardNames(device, 'player_card', 'player_card_name_text', ['as', 'ad', 'ac'], { namedOnly: true });
  await gameGone(device, 'zhajinhua-see-hand-card-button');
  await capture('seen_cards');
  const raise = events([{ event: 'raise', player_id: self, amount: 40, stack: 960 },
    { event: 'pot_update', pot_amount: 160 }]);
  if (animationInfo) {
    const button = await gameReady(device, 'zhajinhua-shortcut-raise-first');
    /** 通过真实按钮和回放消息触发加注筹码动画。 */
    const pressRaise = async () => {
      adb('shell', 'input', 'tap', String(Math.round(button.bounds.x + button.bounds.width / 2)),
        String(Math.round(button.bounds.y + button.bounds.height / 2)));
      await send(raise);
    };
    await captureNativeTransition(device, 'zhajinhua-quick-raise', animationInfo,
      { x: 200, y: 680, width: 410, height: 390 }, pressRaise, [], [], 1200);
  } else {
    await gameTap(device, 'zhajinhua-shortcut-raise-first');
    await send(raise);
  }
  await gameReady(device, `zhajinhua-player-container-${self}`);
  await expect.poll(async () => gameSemanticText((await gameNodes(device))
    .find(node => node.res === `zhajinhua-player-container-${self}`), 'player_stack_text'),
  { timeout: 30_000 }).toBe(`${self} 960`);
  await capture('quick_raise');
  await send(restoreTable(self, false, true));
  await gameReady(device, 'zhajinhua-operation-accurate-bet-button');
  await animateGamePanel(device, 'zhajinhua', 'accurate-bet', 'zhajinhua-operation-accurate-bet-button',
    { x: 150, y: 400, width: 430, height: 480 }, animationInfo);
  await gameReady(device, 'accurate-bet-popup-container');
  await capture('accurate_raise');
  if (animationInfo) await captureNativeTransition(device, 'zhajinhua-accurate-bet-exit', animationInfo,
    { x: 150, y: 400, width: 430, height: 480 }, () => closeGameMask(device, 'accurate-bet-popup-container'));
  else await closeGameMask(device, 'accurate-bet-popup-container');
  await gameTap(device, 'zhajinhua-operation-button-battle');
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'challenge_player_selector').length,
    { timeout: 30_000 }).toBe(4);
  if (animationInfo) {
    const selectors = (await gameNodes(device)).filter(node => node.res === 'challenge_player_selector');
    await captureLoopKeyframes(device, 'zhajinhua-challenge-targets', animationInfo,
      selectors.map(node => node.bounds));
  }
  await capture('challenge_select');
  await gameTap(device, 'zhajinhua-cancel-challenge-choosing');
  await gameTap(device, 'zhajinhua-shortcut-raise-first');
  await send(restoreTable(self, true, true));
  await gameReady(device, `zhajinhua-player-container-${PLAYER_IDS[0]}-operating`);
  await gameGone(device, 'zhajinhua-operation-button-call');
  await capture('opponent_turn');
  const showdown = events([{ event: 'showdown', players: [
    { player_id: self, hole_card: ['as', 'ad', 'ac'], hand_strength: 'three_of_a_kind', is_winner: true },
    { player_id: PLAYER_IDS[0], hole_card: ['kh', 'ks', 'qd'], hand_strength: 'pair', is_winner: false },
  ] }]);
  if (animationInfo) await captureNativeTransition(device, 'zhajinhua-showdown-cards', animationInfo,
    { x: 8, y: 697, width: 170, height: 102 }, () => send(showdown), [], [], 800);
  else await send(showdown);
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'player_cards_container').length,
    { timeout: 30_000 }).toBe(2);
  await capture('showdown');
  const settlement = events([{ event: 'settlement', players: [
    { player_id: self, net: 120, prize: 120, stack: 1120 },
    { player_id: PLAYER_IDS[0], net: -40, prize: 0, stack: 920 },
  ] }]);
  if (animationInfo) await captureNativeTransition(device, 'zhajinhua-settlement', animationInfo,
    { x: 0, y: 680, width: 510, height: 530 }, () => send(settlement), [],
    [{ x: 210, y: 970, width: 190, height: 215 }]);
  else await send(settlement);
  // 与德州一样，摊牌后的牌型会覆盖余额；从当前可见玩家读取明确的余额语义标记。
  await expect.poll(async () => gameSemanticText((await gameNodes(device))
    .find(node => node.res === `zhajinhua-player-container-${self}`), 'player_stack_text'),
  { timeout: 30_000 }).toBe(`${self} 1120`);
  await capture('settlement');
  if (animationInfo) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    for (const name of ['angry', 'cry', 'drink', 'puchi', 'titter', 'smirk', 'handclap']) {
      await captureAssetSequence(device, `zhajinhua-sticker-${name}`, animationInfo,
        { x: 220, y: 990, width: 180, height: 190 },
        () => send({ stream: 'room_message', payload: { action: 'sticker', content: {
          from_user_id: self, to_user_id: PLAYER_IDS[1], file: name,
        } } }));
    }
    for (const name of ['tomato', 'tea', 'water', 'flower', 'heart', 'good', 'beer']) {
      await captureAssetSequence(device, `zhajinhua-prop-${name}`, animationInfo,
        { x: 0, y: 460, width: 180, height: 230 },
        () => send({ stream: 'room_message', payload: { action: 'props', content: {
          from_user_id: self, to_user_id: PLAYER_IDS[1], file: name,
        } } }), { x: 120, y: 700, width: 220, height: 340 });
    }
    // 新牌局清除胜利皇冠，再通过当前房间的真实操作响应触发独立的拼三张升级动画。
    await send(events([{ event: 'new_game', game_id: 'visual-feedback-zhajinhua-game',
      settings: { boot: 1, raise_times: 10, max_round: 20, pot_limit: 2000 } }]));
    await send(restoreTable(self));
    await send(events([restoreTable(self).queue[0]]));
    await gameReady(device, 'zhajinhua-operation-button-call');
    await proxy.command('zhajinhua/operation-reward', { roomId, enabled: true });
    try {
      await animateGamePanel(device, 'zhajinhua', 'level-up', 'zhajinhua-operation-button-call',
        { x: 0, y: 0, width: 720, height: 250 }, animationInfo);
      await gameReady(device, 'zhajinhua-level-up-level-text');
      await animateGamePanel(device, 'zhajinhua', 'level-up', 'zhajinhua-level-up-close-button',
        { x: 0, y: 0, width: 720, height: 250 }, animationInfo, 'exit');
    } finally { await proxy.command('zhajinhua/operation-reward', { roomId, enabled: false }); }
  }
  const status = await proxy.command<{ replayedMessages: number; blockedRpcs: number }>('status');
  expect(status.replayedMessages).toBeGreaterThan(0);
  expect(status.blockedRpcs).toBeGreaterThan(0);
}
