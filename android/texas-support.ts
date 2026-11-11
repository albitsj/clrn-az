import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { restoreTable, type Street, type TableOptions } from '../e2e/helpers/game-scenes';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { motionParts, samePixels } from './motion-regions';
import { adb } from './device';
import { gameGone, gameNodes, gameReady, gameSemanticText, gameTap, gameScreenshot, type NativeNode } from './game-controls';
import { gameMenu } from './game-pregame';
import { gameCardNames, replay } from './game-replay';
import type { ScreenshotMask } from './screenshot';

export type TexasContext = {
  device: AndroidDevice; proxy: Mitmproxy; room: string; self: string;
  animationInfo?: TestInfo; diagnosticsInfo?: TestInfo;
  capture(state: string, masks?: ScreenshotMask[], triggerTransient?: () => Promise<string | void>): Promise<void>;
};

// 与动作标签录屏共用同一区域，不包含头像倒计时。
export const playerActionRegion = { x: 132, y: 465, width: 63, height: 130 };

/**
 * 前一动作的退场完成后再触发下一动作，不能仅检查下一动作的节点尚未出现。
 * @param device - 专用模拟器连接。
 * @param testInfo - 当前采集报告。
 * @param action - 即将触发的玩家动作。
 */
export async function waitForPlayerActionStart(device: AndroidDevice, testInfo: TestInfo,
  action: string): Promise<void> {
  const name = `texas-player-action-${action}`;
  // 四种动作共用已审查的空牌桌；准备依据独立于本轮 reference 将生成的输出。
  const reference = readFileSync(path.join(__dirname,
    'snapshots/android-35-x86_64-720x1280-en/texas-player-action-call-start.png'));
  let current: Buffer | undefined;
  const samples: { at: number; ready: boolean }[] = [];
  try {
    await expect.poll(async () => {
      current = motionParts(await gameScreenshot(device), [playerActionRegion]).regions[0];
      const ready = samePixels(current, reference);
      samples.push({ at: Date.now(), ready });
      return ready;
    }, { message: '上一玩家动作必须完成退场后才能采集下一动作', timeout: 30_000, intervals: [250] }).toBe(true);
  } finally {
    try {
      if (current) await testInfo.attach(`${name}-prepared-start`, { body: current, contentType: 'image/png' });
      await testInfo.attach(`${name}-prepared-timing`, {
        body: JSON.stringify(samples), contentType: 'application/json',
      });
    } catch { /* 诊断失败不得替换原始准备异常或使成功用例失败。 */ }
  }
}

/**
 * 复用 Python 命名场景恢复牌局，等待五个真实牌面容器完成更新。
 * @param context - 当前真实房间及原生连接。
 * @param options - Python 中登记的牌桌布局和操作分支。
 * @param street - 要恢复的回合。
 * @param opponent - 是否轮到对手操作。
 */
export async function restoreTexas(context: TexasContext, options?: TableOptions, street?: Street, opponent?: boolean): Promise<void> {
  street = texasStreet(street);
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

/** 统一恢复牌局时的默认街。
 * @param street - 调用方指定的街。
 */
function texasStreet(street: Street = 'river'): Street { return street; }

/** 从当前可见玩家读取牌型覆盖下仍保留的余额语义节点。
 * @param context - 当前真实房间。
 * @param amount - 牌局预期余额。
 */
export async function expectTexasBalance(context: TexasContext, amount: string): Promise<void> {
  await expect.poll(async () => gameSemanticText((await gameNodes(context.device))
    .find(node => node.res === `texas-holdem-player-container-${context.self}`), 'text-holdem-own-balance-text'),
    { timeout: 30_000 }).toBe(amount);
}
