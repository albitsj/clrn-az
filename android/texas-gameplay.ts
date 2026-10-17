import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { events, REPLAY_PLAYER_IDS, restoreTable, type Street } from '../visual/cases/texas-holdem/replayData';
import { flattenNodes, gameConnected, gameReady, gameGone, gameTap, gameNodes, gameSemanticText } from './game-controls';
import { replay, gameCardNames } from './game-replay';
import { closeAnimatedGameMask, closeGameMask } from './game-pregame';
import { dismissKeyboard } from './keyboard';
import { gameTapText, type TexasContext } from './texas-support';
import { captureNativeTransition, captureTransientTransition } from './animation-transition';
import { animateGamePanel } from './game-panel-animation';
import { captureMovingKeyframes } from './loop-keyframes';
import { captureAssetSequence } from './asset-sequence';
import { adb } from './device';

/**
 * 复用网页的德州消息夹具，覆盖各街、操作、摊牌、结算和玩家资料。
 * @param device - 专用模拟器连接。
 * @param proxy - 本轮独占代理。
 * @param roomId - 本轮新建的房间。
 * @param self - 真实登录用户 ID。
 * @param capture - 按共享状态清单采集截图。
 * @param animationInfo - 英文真实公共牌关键帧基准。
 */
export async function texasGameplay(device: AndroidDevice, proxy: Mitmproxy, roomId: string,
  self: string, capture: TexasContext['capture'], animationInfo?: TestInfo): Promise<void> {
  /**
   * 发送共用网络事件。
   * @param data - Web 消息夹具。
   */
  const send = (data: unknown) => replay(proxy, 'texas', roomId, data);
  /**
   * 恢复牌局并验证五张公共牌位置。
   * @param street - 当前街。
   * @param opponent - 是否轮到对手。
   */
  const restore = async (street: Street, opponent = false) => {
    const regions = {
      preflop: { x: 360, y: 1054, width: 137, height: 102 },
      flop: { x: 151, y: 603, width: 249, height: 117 },
      turn: { x: 408, y: 603, width: 76, height: 117 },
      river: { x: 492, y: 603, width: 78, height: 117 },
    };
    if (animationInfo && !opponent) {
      /** 起手牌先建立背面牌位，再下发手牌；整批状态与手牌同帧渲染会跳过翻牌中间帧。 */
      const publish = async () => {
        const state = restoreTable(self, street, opponent);
        if (street !== 'preflop') { await send(state); return; }
        const hand = state.queue.find(item => item.event === 'hand_card');
        if (!hand) throw new Error('起手牌回放缺少 hand_card 事件。');
        await send({ ...state, queue: state.queue.filter(item => item !== hand) });
        await new Promise(resolve => setTimeout(resolve, 400));
        await send(events([hand]));
      };
      /** 四种翻牌动作均可能短于原生截图间隔，改用持续录屏。 */
      await captureNativeTransition(device, `texas-${street}-cards`, animationInfo, regions[street], publish,
        [], [], 0, 'videoFrames', undefined, undefined,
        street === 'preflop' ? ['texas-preflop-cards-backed.png', 'texas-preflop-cards-turning.png'] : []);
    } else await send(restoreTable(self, street, opponent));
    const count = { preflop: 0, flop: 3, turn: 4, river: 5 }[street];
    await gameCardNames(device, 'community_card', 'community_card_name_text', ['ah', 'kd', '7c', '2s', 'qs']
      .map((card, index) => index < count ? card : 'back'));
    await expect.poll(async () => (await gameNodes(device))
      .some(node => node.res?.startsWith(`texas-holdem-player-container-${self}`)), { timeout: 30_000 }).toBe(true);
    if (!opponent) await gameReady(device, 'texas-holdem-operation-button-raise');
  };
  for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
    await restore(street);
    if (street === 'preflop' && animationInfo) {
      const timer = (await gameNodes(device)).find(node => node.res === 'texas-holdem-active-countdown');
      expect(timer, '德州本人操作倒计时必须可见').toBeDefined();
      await captureMovingKeyframes(device, 'texas-operation-countdown', animationInfo, [timer!.bounds]);
    }
    await capture(street);
  }
  await animateGamePanel(device, 'texas-holdem', 'raise-bet', 'texas-holdem-operation-button-raise',
    { x: 320, y: 245, width: 190, height: 430 }, animationInfo, 'enter', 'videoFrames');
  await gameReady(device, 'raise-bet-popup');
  await capture('raise');
  if (animationInfo) {
    await gameReady(device, 'raise-bet-slider');
    const initialRaise = (await gameReady(device, 'raise-bet-display-text')).text;
    await captureNativeTransition(device, 'texas-raise-slider', animationInfo,
      { x: 285, y: 245, width: 295, height: 630 },
      () => adb('shell', 'input', 'swipe', '333', '814', '333', '530', '450'),
      [{ x: 285, y: 725, width: 160, height: 35,
        reason: '加注滑块后面的牌局倒计时独立跳秒' }], [], 0, 'videoFrames',
      undefined, undefined, [], ['texas-raise-slider-end-500.png', 'texas-raise-slider-end-492.png'],
      [{ x: 120, y: 250, width: 160, height: 105,
        reason: '终点加注数字由拖动采样量化；完整标签保留在报告，数值另用原生文本断言' }]);
    expect((await gameReady(device, 'raise-bet-display-text')).text,
      '真实拖动必须改变加注数值').not.toBe(initialRaise);
  }
  // 原生录屏确认取消按钮直接移除面板，没有可供回归的退场过渡帧。
  for (let attempt = 0; attempt < 3; attempt++) {
    await gameConnected(device);
    await gameTap(device, 'raise-bet-cancel-button');
    try {
      await expect.poll(async () => (await gameNodes(device)).some(node => node.res === 'raise-bet-popup'),
        { timeout: 10_000, intervals: [250] }).toBe(false);
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await gameGone(device, 'raise-bet-popup');
  await animateGamePanel(device, 'texas-holdem', 'accurate-bet', 'texas-holdem-operation-accurate-bet-button',
    { x: 120, y: 360, width: 480, height: 330 }, animationInfo);
  await gameReady(device, 'accurate-bet-popup-container');
  await capture('accurate_raise');
  if (animationInfo) await closeAnimatedGameMask(device, 'texas-holdem', 'accurate-bet',
    'accurate-bet-popup-container', { x: 120, y: 360, width: 480, height: 330 }, animationInfo,
    [], 'videoFrames');
  else await closeGameMask(device, 'accurate-bet-popup-container');
  await restore('river', true);
  if (animationInfo) {
    await send(events([{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0],
      valid_bets: { call: { amount: 20 } } }]));
    await gameGone(device, 'texas-holdem-operation-button-raise');
    await expect.poll(async () => (await gameNodes(device))
      .some(node => node.res?.startsWith('texas-holdem-auto-button-')), { timeout: 30_000 }).toBe(true);
    // 对手自动操作按钮先完成入场，再单独采样本人操作按钮。
    await new Promise(resolve => setTimeout(resolve, 1000));
    await captureNativeTransition(device, 'texas-operation-buttons', animationInfo,
      { x: 100, y: 865, width: 500, height: 150 }, () => send(events([{ event: 'switch_player',
        player_id: self, valid_bets: { fold: {}, call: { amount: 20 },
          raise: { minimum: 40, maximum: 1000 }, all_in: { amount: 1000 } },
      }])), [], [], 400);
    await gameReady(device, 'texas-holdem-operation-button-raise');
    await restore('river', true);
  }
  await send(events([{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0], valid_bets: { call: { amount: 20 } } }]));
  await gameGone(device, 'texas-holdem-operation-button-raise');
  await capture('opponent_turn');
  if (animationInfo) {
    // 结算会销毁手牌引用；四种动作必须在仍进行的牌局中分别触发。
    const actionPlayer = REPLAY_PLAYER_IDS[1];
    for (const action of ['call', 'raise', 'check', 'fold'] as const) {
      await restore('river', true);
      await send(events([{ event: 'switch_player', player_id: actionPlayer,
        remain_operating_seconds: 12 }]));
      /** 从本轮指定玩家读取实际可见动作，忽略其他座位仍保留的操作标记。 */
      const playerAction = async () => {
        const player = (await gameNodes(device)).find(node => node.res?.startsWith(`texas-holdem-player-container-${actionPlayer}`));
        return player && flattenNodes(player).some(node => node.res === `texas-holdem-player-action-${action}`);
      };
      await expect.poll(playerAction, { timeout: 30_000 }).toBe(false);
      const timer = await gameReady(device, 'texas-holdem-active-countdown');
      await captureNativeTransition(device, `texas-player-action-${action}`, animationInfo,
        { x: 80, y: 465, width: 115, height: 130 },
        () => send(events([{ event: action, player_id: actionPlayer, amount: 40, stack: 920 }])),
        [{ ...timer.bounds, reason: '玩家动作期间独立运行的操作倒计时' }], [], 0, 'videoFrames');
      await expect.poll(playerAction, { timeout: 30_000 }).toBe(true);
    }
    await restore('river', true);
    await send(events([{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0],
      valid_bets: { call: { amount: 20 } } }]));
    // 上一轮弃牌的标签退场和座位切换会继续绘制一小段时间；
    // 等它们结束后再取全压特效的第一帧，确保第一帧是稳定的起点。
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  const allIn = events([{ event: 'all_in', player_id: REPLAY_PLAYER_IDS[0], amount: 960, stack: 0 },
    { event: 'all_in_show_hole_card', players: [{ player_id: REPLAY_PLAYER_IDS[0], hole_card: ['kh', 'ks'] }] }]);
  if (animationInfo) await captureNativeTransition(device, 'texas-all-in-fire', animationInfo,
    { x: 0, y: 650, width: 250, height: 225 }, () => send(allIn),
    [{ x: 65, y: 695, width: 70, height: 90, reason: '全压特效旁的对手操作秒数独立跳秒' }], [], 1600);
  else await send(allIn);
  await gameReady(device, 'texas-holdem-player-action-all_in');
  await capture('all_in');
  const showdown = events([{ event: 'showdown', players: [
    { player_id: self, hole_card: ['as', 'ad'], best_cards: ['as', 'ad', 'ah', 'kd', 'qs'],
      hand_strength: 'three_of_a_kind', strength_cards: ['as', 'ad', 'ah'], is_max_strength: true },
    { player_id: REPLAY_PLAYER_IDS[0], hole_card: ['kh', 'ks'], best_cards: ['kh', 'ks', 'kd', 'ah', 'qs'],
      hand_strength: 'three_of_a_kind', strength_cards: ['kh', 'ks', 'kd'], is_max_strength: false },
  ] }]);
  if (animationInfo) await captureNativeTransition(device, 'texas-showdown', animationInfo,
    { x: 0, y: 580, width: 600, height: 600 }, () => send(showdown),
    [{ x: 334, y: 720, width: 110, height: 47, reason: '摊牌旁的房间计时独立跳秒' }], [], 1600,
    'videoFrames');
  else await send(showdown);
  await capture('showdown');
  const settlement = events([{ event: 'settlement', players: [
    { player_id: self, net: 180, prize: 180, stack: 1180 },
    { player_id: REPLAY_PLAYER_IDS[0], net: -960, prize: 0, stack: 0 },
  ] }]);
  if (animationInfo) await captureTransientTransition(device, 'texas-settlement', animationInfo,
    { x: 150, y: 950, width: 390, height: 250 }, () => send(settlement), 1600);
  else await send(settlement);
  // 摊牌时余额被牌型标签替代；余额语义标记仍附在当前可见玩家容器内。
  await expect.poll(async () => gameSemanticText((await gameNodes(device))
    .find(node => node.res === `texas-holdem-player-container-${self}`), 'text-holdem-own-balance-text'),
  { timeout: 30_000 }).toBe('1180');
  await capture('settlement');
  if (animationInfo) {
    // 牌桌的 WebP 清单已经逐字节校验；这里还验证每种效果确实由房间消息在原生画面播放。
    await new Promise(resolve => setTimeout(resolve, 3000));
    for (const name of ['angry', 'cry', 'drink', 'puchi', 'titter', 'smirk', 'handclap']) {
      await captureAssetSequence(device, `texas-sticker-${name}`, animationInfo,
        { x: 220, y: 990, width: 180, height: 190 },
        () => send({ stream: 'room_message', payload: { action: 'sticker', content: {
          from_user_id: self, to_user_id: REPLAY_PLAYER_IDS[1], file: name,
        } } }));
    }
    for (const name of ['tomato', 'tea', 'water', 'flower', 'heart', 'good', 'beer']) {
      await captureAssetSequence(device, `texas-prop-${name}`, animationInfo,
        { x: 0, y: 460, width: 180, height: 230 },
        () => send({ stream: 'room_message', payload: { action: 'props', content: {
          from_user_id: self, to_user_id: REPLAY_PLAYER_IDS[1], file: name,
        } } }), { x: 120, y: 700, width: 220, height: 340 });
    }
  }
  let opponentProfileCount = 0;
  const profileNetworkMask = [{ x: 635, y: 145, width: 85, height: 65,
    reason: '玩家资料后面的实时网络延迟独立变化' }];
  const ownProfileMasks = [...profileNetworkMask,
    { x: 226, y: 338, width: 115, height: 30, reason: '本人资料 ID 随测试账号池轮转' }];
  /**
   * 打开玩家资料，等待统计数据实际完成加载。
   * @param player - 共享夹具玩家或本人 ID。
   */
  const profile = async (player: string) => {
    const node = (await gameNodes(device)).find(item => item.res?.startsWith(`texas-holdem-player-container-${player}`));
    expect(node).toBeDefined();
    const name = player === self ? 'own-profile' : `opponent-profile-${++opponentProfileCount}`;
    await animateGamePanel(device, 'texas-holdem', name,
      node!.res!, { x: 180, y: 90, width: 520, height: 500 }, animationInfo,
      'enter', 'videoFrames', player === self ? ownProfileMasks : profileNetworkMask,
      async () => { await gameReady(device, 'PlayerStatisticComponent_Item_Value_0'); });
    await gameReady(device, 'player-profile-popup-close');
    await gameReady(device, 'PlayerStatisticComponent_Item_Value_0');
  };
  await profile(self);
  await capture('own_profile');
  await animateGamePanel(device, 'texas-holdem', 'own-profile', 'player-profile-popup-close',
    { x: 180, y: 90, width: 520, height: 500 }, animationInfo,
    'exit', 'videoFrames', ownProfileMasks,
    async () => { await gameGone(device, 'player-profile-popup-close'); });
  await gameGone(device, 'player-profile-popup-close');
  await profile(REPLAY_PLAYER_IDS[0]);
  await gameReady(device, 'player-profile-nickname', 'Player1');
  await capture('player_profile');
  await gameTapText(device, /^(千场统计|千場統計|1000 Times Statistics)$/);
  await gameReady(device, 'PlayerStatisticComponent_Item_Value_0', '1000');
  await capture('player_statistics_1000');
  await capture('statistics_help', [], () => gameTap(device, 'PlayerStatisticComponent_Item_1', true));
  await gameGone(device, 'toastText1');
  await animateGamePanel(device, 'texas-holdem', 'report', 'player-profile-report-button',
    { x: 50, y: 250, width: 620, height: 380 }, animationInfo);
  await gameReady(device, 'report-field-input');
  await dismissKeyboard(device);
  await capture('report');
  if (animationInfo) await closeAnimatedGameMask(device, 'texas-holdem', 'report',
    'report-field-input', { x: 50, y: 250, width: 620, height: 380 }, animationInfo, [], 'videoFrames');
  else await closeGameMask(device, 'report-field-input');
  await profile(REPLAY_PLAYER_IDS[0]);
  await gameTap(device, 'player-profile-block-button');
  await capture('block');
  await animateGamePanel(device, 'texas-holdem', 'opponent-profile-2', 'player-profile-popup-close',
    { x: 180, y: 90, width: 520, height: 500 }, animationInfo,
    'exit', 'motionFrames', profileNetworkMask,
    async () => { await gameGone(device, 'player-profile-popup-close'); });
  expect((await proxy.command<{ replayedMessages: number }>('status')).replayedMessages).toBeGreaterThan(0);
}
