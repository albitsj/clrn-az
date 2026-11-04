import { readFileSync } from 'node:fs';
import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { restoreTable, type Street, type TableOptions } from '../e2e/helpers/game-scenes';
import { flattenNodes, gameGone, gameNodes, gameReady, gameTap, gameScreenshot, type NativeNode } from './game-controls';
import { motionParts, samePixels } from './motion-regions';
import { gameCardNames, replay } from './game-replay';
import { adb } from './device';
import type { ScreenshotMask } from './screenshot';
import { gameMenu } from './game-pregame';

export type TexasContext = {
  device: AndroidDevice; proxy: Mitmproxy; room: string; self: string;
  animationInfo?: TestInfo;
  capture(state: string, masks?: ScreenshotMask[], triggerTransient?: () => Promise<string | void>): Promise<void>;
};

// 与动作标签录屏共用同一区域，不包含头像倒计时。
export const playerActionRegion = { x: 132, y: 465, width: 63, height: 130 };

/**
 * 前一动作的退场完成后再触发下一动作，不能仅检查下一动作的节点尚未出现。
 * @param device - 专用模拟器连接。
 * @param testInfo - 当前报告、采集模式与起点基准。
 * @param action - 即将触发的玩家动作。
 * @param playerId - 本轮动作所属玩家，避免其他座位的标签影响退场判断。
 */
export async function waitForPlayerActionStart(device: AndroidDevice, testInfo: TestInfo,
  action: string, playerId: string): Promise<void> {
  const name = `texas-player-action-${action}`;
  const reference = testInfo.config.updateSnapshots === 'all'
    ? undefined : readFileSync(testInfo.snapshotPath(`${name}-start.png`));
  let current: Buffer | undefined;
  let previous: Buffer | undefined;
  let stableSince = 0;
  try {
    await expect.poll(async () => {
      current = motionParts(await gameScreenshot(device), [playerActionRegion]).regions[0];
      if (reference) return samePixels(current, reference);
      // 首次候选采集没有基准：目标玩家的所有旧动作均须消失，且绘制区域稳定后才采集。
      const player = (await gameNodes(device)).find(node => node.res?.startsWith(`texas-holdem-player-container-${playerId}`));
      if (!player || flattenNodes(player).some(node => node.res?.startsWith('texas-holdem-player-action-'))) {
        previous = undefined;
        return false;
      }
      if (!previous || !samePixels(current, previous)) {
        stableSince = Date.now();
        previous = current;
      }
      return Date.now() - stableSince >= 500;
    }, { message: '上一玩家动作必须完成退场后才能采集下一动作', timeout: 30_000, intervals: [250] }).toBe(true);
  } finally {
    if (current) await testInfo.attach(`${name}-prepared-start`, { body: current, contentType: 'image/png' });
  }
}

/**
 * 复用 Python 命名场景恢复牌局，等待五个真实牌面容器完成更新。
 * @param context - 当前真实房间及原生连接。
 * @param options - Python 中登记的牌桌布局和操作分支。
 * @param street - 要恢复的回合。
 * @param opponent - 是否轮到对手操作。
 */
export async function restoreTexas(context: TexasContext, options: TableOptions = 'standard', street: Street = 'river', opponent = false): Promise<void> {
  await replay(context.proxy, 'texas', context.room, restoreTable(street, opponent, options));
  const count = { preflop: 0, flop: 3, turn: 4, river: 5 }[street];
  await gameCardNames(context.device, 'community_card', 'community_card_name_text',
    ['ah', 'kd', '7c', '2s', 'qs'].map((card, index) => index < count ? card : 'back'));
}

/**
 * 选择本轮真实房间的 Python 消息场景。
 * @param context - 当前真实房间及原生连接。
 * @param scene - Python 中登记的回放场景。
 */
export async function texasEvents(context: TexasContext, scene: string): Promise<void> {
  await replay(context.proxy, 'texas', context.room, { scene });
}

/**
 * 等待并点击没有独立 testID 的原生文字，位置连续稳定后才输入。
 * @param device - 专用模拟器连接。
 * @param text - 三种语言共用的准确文字模式。
 */
export async function gameTapText(device: AndroidDevice, text: RegExp): Promise<void> {
  let previous: NativeNode['bounds'] | undefined;
  let selected: NativeNode | undefined;
  await expect(async () => {
    selected = (await gameNodes(device)).filter(node => text.test(node.text || '')).at(-1);
    expect(selected, `${text} 应可见`).toBeDefined();
    const before = previous;
    previous = selected!.bounds;
    expect(previous).toEqual(before);
  }).toPass({ timeout: 30_000, intervals: [250] });
  const { x, y, width, height } = selected!.bounds;
  adb('shell', 'input', 'tap', String(Math.round(x + width / 2)), String(Math.round(y + height / 2)));
}

/**
 * 通过实际开关启用牌桌功能，不直接修改组件状态。
 * @param device - 专用模拟器连接。
 * @param setting - 共用的开关后缀。
 */
export async function enableGameSetting(device: AndroidDevice, setting: string): Promise<void> {
  await gameMenu(device, 'settings', 'game-settings-popup-container');
  const marker = `game-settings-switch-${setting}`;
  if (!(await gameReady(device, marker)).checked) await gameTap(device, marker);
  await expect.poll(async () => (await gameReady(device, marker)).checked, { timeout: 30_000 }).toBe(true);
  await gameTap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-popup-container');
}
