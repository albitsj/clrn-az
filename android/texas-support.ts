import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { restoreTable, type Street, type TableOptions } from '../e2e/helpers/game-scenes';
import { gameGone, gameNodes, gameReady, gameTap, type NativeNode } from './game-controls';
import { gameCardNames, replay } from './game-replay';
import { adb } from './device';
import type { ScreenshotMask } from './screenshot';
import { gameMenu } from './game-pregame';

export type TexasContext = {
  device: AndroidDevice; proxy: Mitmproxy; room: string; self: string;
  animationInfo?: TestInfo;
  capture(state: string, masks?: ScreenshotMask[], triggerTransient?: () => Promise<string | void>): Promise<void>;
};

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
