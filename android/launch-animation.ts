import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb, applicationId } from './device';
import { frameColorDistance } from './animation-transition';
import { motionParts, samePixels } from './motion-regions';

type LaunchFrame = { before: { text?: string }; after: { text?: string }; capturedAt: number; png: string };

/**
 * 在 APK 首次启动期间抓取品牌字样的原生淡入帧，独立于初始化完成时间。
 * @param device - 已连接驱动但尚未启动被测应用的模拟器。
 * @param testInfo - Playwright 测试报告。
 */
export async function captureLaunchBranding(device: AndroidDevice, testInfo: TestInfo): Promise<void> {
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string, params: { resource: string; waitMs: number }): Promise<LaunchFrame[]> } } })._connection.toImpl(device);
  const timeout = new AbortController();
  let frames: LaunchFrame[];
  try {
    const pending = Promise.race([
      implementation._send('transientFrames', { resource: 'launch-brand-name', waitMs: 15_000 }),
      setTimeout(25_000, undefined, { signal: timeout.signal }).then(() => { throw new Error('启动品牌采样超时。'); }),
    ]);
    await setTimeout(300);
    adb('shell', 'am', 'start', '-n', `${applicationId}/com.laiwan_react_native.MainActivity`);
    frames = await pending;
  } finally { timeout.abort(); }
  expect(frames.length, '品牌淡入时须采集多帧真实屏幕').toBeGreaterThanOrEqual(3);
  const region = { x: 60, y: 150, width: 600, height: 250 };
  const pictures = frames.map(frame => motionParts(Buffer.from(frame.png, 'base64'), [region]).regions[0]);
  for (const [index, frame] of frames.entries()) {
    expect(frame.before.text, '截图前品牌名称须已挂载').toBeTruthy();
    expect(frame.after.text, '截图后品牌名称须保持一致').toBe(frame.before.text);
    await testInfo.attach(`launch-branding-frame-${index}`, { body: pictures[index], contentType: 'image/png' });
  }
  await testInfo.attach('launch-branding-timeline', {
    body: JSON.stringify(frames.map(({ capturedAt }) => capturedAt)), contentType: 'application/json',
  });
  const first = pictures[0], last = pictures.at(-1)!;
  const total = frameColorDistance(first, last);
  await testInfo.attach('launch-branding-difference', { body: JSON.stringify({ total }), contentType: 'application/json' });
  expect(total, '启动品牌必须在真实屏幕上逐渐显示').toBeGreaterThan(2);
  const candidates = pictures.map((frame, index) => ({ frame, index,
    progress: frameColorDistance(first, frame) / total,
    remaining: frameColorDistance(last, frame) / total }))
    .filter(item => item.progress > 0.1 && item.remaining > 0.1);
  expect(candidates.length, '品牌须出现独立的淡入中间帧').toBeGreaterThan(0);
  const middle = candidates.reduce((best, item) => Math.min(item.progress, item.remaining)
    > Math.min(best.progress, best.remaining) ? item : best);
  for (const [name, picture] of [['start', first], ['middle', middle.frame], ['end', last]] as const) {
    await testInfo.attach(`launch-branding-${name}`, { body: picture, contentType: 'image/png' });
  }
  if (testInfo.config.updateSnapshots === 'all') {
    expect(first).toMatchSnapshot('launch-branding-start.png');
    expect(middle.frame).toMatchSnapshot('launch-branding-middle.png');
    expect(last).toMatchSnapshot('launch-branding-end.png');
  } else {
    expect(samePixels(first, readFileSync(testInfo.snapshotPath('launch-branding-start.png')))).toBe(true);
    expect(samePixels(last, readFileSync(testInfo.snapshotPath('launch-branding-end.png')))).toBe(true);
    const reference = readFileSync(testInfo.snapshotPath('launch-branding-middle.png'));
    expect(Math.min(...candidates.map(item => frameColorDistance(item.frame, reference)))).toBeLessThanOrEqual(12);
  }
}
