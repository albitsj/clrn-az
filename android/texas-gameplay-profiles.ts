import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { REPLAY_PLAYER_IDS } from '../e2e/helpers/game-scenes';
import {
  gameGone,
  gameNodes,
  gameReady,
  gameScreenshot,
  gameTap
} from './game-controls';
import { animateGamePanel } from './game-panel-animation';
import { closeAnimatedGameMask } from './game-pregame';
import { dismissKeyboard } from './keyboard';
import { motionParts, samePixels } from './motion-regions';
import { maskScreenshot } from './screenshot';
import { gameTapText, type TexasContext } from './texas-support';

import { captureConnected } from './game-capture-retry';

/** 保持本人、对手资料及举报拉黑的原有断言。
 * @param context - 当前真实房间、设备及报告。
 */
export async function texasGameplayProfiles(context: TexasContext): Promise<void> {
  const { device, proxy, self, capture, animationInfo } = context;
  let opponentProfileCount = 0;
  const profileNetworkMask = [{
    x: 635, y: 145, width: 85, height: 65,
    reason: '玩家资料后面的实时网络延迟独立变化'
  }];
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
    const region = { x: 180, y: 90, width: 520, height: 500 };
    const masks = player === self ? ownProfileMasks : profileNetworkMask;
    await animateGamePanel(device, 'texas-holdem', name,
      node!.res!, region, animationInfo, 'enter', 'videoFrames', masks,
      async () => {
        await gameReady(device, 'PlayerStatisticComponent_Item_Value_0');
        if (!animationInfo || animationInfo.config.updateSnapshots === 'all') return;
        const expected = readFileSync(animationInfo.snapshotPath(`texas-holdem-${name}-enter-end.png`));
        // 统计值节点可能先于下方加载圈出现；等整个已审查面板真正绘制完成。
        await expect.poll(async () => {
          const actual = motionParts(maskScreenshot(await gameScreenshot(device), masks), [region]).regions[0];
          return samePixels(actual, expected);
        }, { timeout: 45_000, intervals: [300] }).toBe(true);
      });
    await gameReady(device, 'player-profile-popup-close');
    await gameReady(device, 'PlayerStatisticComponent_Item_Value_0');
  };
  await profile(self);
  await captureConnected(device, capture, 'own_profile');
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
    { x: 50, y: 250, width: 620, height: 380 }, animationInfo, 'enter', 'videoFrames');
  await gameReady(device, 'report-field-input');
  await dismissKeyboard(device);
  await capture('report');
  await closeAnimatedGameMask(device, 'texas-holdem', 'report',
    'report-field-input', { x: 50, y: 250, width: 620, height: 380 }, animationInfo, [], 'videoFrames');
  await profile(REPLAY_PLAYER_IDS[0]);
  await gameTap(device, 'player-profile-block-button');
  await capture('block');
  await animateGamePanel(device, 'texas-holdem', 'opponent-profile-2', 'player-profile-popup-close',
    { x: 180, y: 90, width: 520, height: 500 }, animationInfo,
    'exit', 'videoFrames', profileNetworkMask,
    async () => { await gameGone(device, 'player-profile-popup-close'); });
  expect((await proxy.command<{ replayedMessages: number }>('status')).replayedMessages).toBeGreaterThan(0);
}
