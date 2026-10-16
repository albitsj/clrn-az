import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { events, REPLAY_PLAYER_IDS, restoreTable, type Street } from '../visual/cases/texas-holdem/replayData';
import { flattenNodes, gameReady, gameGone, gameTap, gameNodes, gameSemanticText } from './game-controls';
import { replay, gameCardNames } from './game-replay';
import { closeAnimatedGameMask, closeGameMask } from './game-pregame';
import { dismissKeyboard } from './keyboard';
import { gameTapText, type TexasContext } from './texas-support';
import { captureNativeTransition, captureTransientTransition } from './animation-transition';
import { animateGamePanel } from './game-panel-animation';
import { captureMovingKeyframes } from './loop-keyframes';
import { captureAssetSequence } from './asset-sequence';

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
      /** 起手牌及单张转牌、河牌不足原生截图间隔，改用持续录屏。 */
      const publish = () => send(restoreTable(self, street, opponent));
      await captureNativeTransition(device, `texas-${street}-cards`, animationInfo, regions[street], publish,
        [], [], 0, street === 'flop' ? 'motionFrames' : 'videoFrames');
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
    { x: 320, y: 245, width: 190, height: 430 }, animationInfo);
  await gameReady(device, 'raise-bet-popup');
  await capture('raise');
  // 原生录屏确认取消按钮直接移除面板，没有可供回归的退场过渡帧。
  await gameTap(device, 'raise-bet-cancel-button');
  await gameGone(device, 'raise-bet-popup');
  await animateGamePanel(device, 'texas-holdem', 'accurate-bet', 'texas-holdem-operation-accurate-bet-button',
    { x: 120, y: 360, width: 480, height: 330 }, animationInfo);
  await gameReady(device, 'accurate-bet-popup-container');
  await capture('accurate_raise');
  if (animationInfo) await closeAnimatedGameMask(device, 'texas-holdem', 'accurate-bet',
    'accurate-bet-popup-container', { x: 120, y: 360, width: 480, height: 330 }, animationInfo);
  else await closeGameMask(device, 'accurate-bet-popup-container');
  await restore('river', true);
  await send(events([{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0], valid_bets: { call: { amount: 20 } } }]));
  await gameGone(device, 'texas-holdem-operation-button-raise');
  await capture('opponent_turn');
  const allIn = events([{ event: 'all_in', player_id: REPLAY_PLAYER_IDS[0], amount: 960, stack: 0 },
    { event: 'all_in_show_hole_card', players: [{ player_id: REPLAY_PLAYER_IDS[0], hole_card: ['kh', 'ks'] }] }]);
  if (animationInfo) await captureNativeTransition(device, 'texas-all-in-fire', animationInfo,
    { x: 0, y: 650, width: 250, height: 225 }, () => send(allIn),
    [{ x: 80, y: 695, width: 55, height: 90, reason: '全压特效旁的对手操作秒数独立跳秒' }], [], 1600);
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
    [{ x: 334, y: 720, width: 110, height: 47, reason: '摊牌旁的房间计时独立跳秒' }]);
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
  /**
   * 打开玩家资料，等待统计数据实际完成加载。
   * @param player - 共享夹具玩家或本人 ID。
   */
  const profile = async (player: string) => {
    const node = (await gameNodes(device)).find(item => item.res?.startsWith(`texas-holdem-player-container-${player}`));
    expect(node).toBeDefined();
    const name = player === self ? 'own-profile' : `opponent-profile-${++opponentProfileCount}`;
    await animateGamePanel(device, 'texas-holdem', name,
      node!.res!, { x: 180, y: 90, width: 520, height: 500 }, animationInfo);
    await gameReady(device, 'player-profile-popup-close');
    await gameReady(device, 'PlayerStatisticComponent_Item_Value_0');
  };
  await profile(self);
  await capture('own_profile');
  await animateGamePanel(device, 'texas-holdem', 'own-profile', 'player-profile-popup-close',
    { x: 180, y: 90, width: 520, height: 500 }, animationInfo, 'exit');
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
    'report-field-input', { x: 50, y: 250, width: 620, height: 380 }, animationInfo);
  else await closeGameMask(device, 'report-field-input');
  await profile(REPLAY_PLAYER_IDS[0]);
  await gameTap(device, 'player-profile-block-button');
  await capture('block');
  await animateGamePanel(device, 'texas-holdem', 'opponent-profile-2', 'player-profile-popup-close',
    { x: 180, y: 90, width: 520, height: 500 }, animationInfo, 'exit');
  if (animationInfo) {
    await restore('river', true);
    const actionPlayer = REPLAY_PLAYER_IDS[1];
    for (const action of ['call', 'raise', 'check', 'fold'] as const) {
      await send(events([{ event: 'switch_player', player_id: actionPlayer,
        remain_operating_seconds: 12 }]));
      /** 从本轮指定玩家读取实际可见动作，忽略其他座位仍保留的操作标记。 */
      const playerAction = async () => {
        const player = (await gameNodes(device)).find(node => node.res?.startsWith(`texas-holdem-player-container-${actionPlayer}`));
        return player && flattenNodes(player).some(node => node.res === `texas-holdem-player-action-${action}`);
      };
      await expect.poll(playerAction, { timeout: 30_000 }).toBe(false);
      const timer = (await gameNodes(device)).find(node => node.res === 'texas-holdem-active-countdown');
      expect(timer, `${action} 前对手操作倒计时必须可见`).toBeDefined();
      await captureNativeTransition(device, `texas-player-action-${action}`, animationInfo,
        { x: 80, y: 465, width: 115, height: 155 },
        () => send(events([{ event: action, player_id: actionPlayer, amount: 40, stack: 920 }])),
        [{ ...timer!.bounds, reason: '玩家动作期间独立运行的操作倒计时' }]);
      await expect.poll(playerAction, { timeout: 30_000 }).toBe(true);
    }
  }
  expect((await proxy.command<{ replayedMessages: number }>('status')).replayedMessages).toBeGreaterThan(0);
}
