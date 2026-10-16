import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { AndroidDevice } from 'playwright';
import { gameScreenshot } from './game-controls';
import { motionParts, samePixels } from './motion-regions';
import type { ScreenshotBounds } from './screenshot';

type NativeFrame = { capturedAt: number; png: string };

/**
 * 局部画面平均色差；忽略编码差异，保留移动、缩放及透明度变化。
 * @param left - 第一张局部 PNG。
 * @param right - 第二张局部 PNG。
 */
export function frameColorDistance(left: Buffer, right: Buffer): number {
  const a = PNG.sync.read(left), b = PNG.sync.read(right);
  if (a.width !== b.width || a.height !== b.height) throw new Error('动画帧尺寸变化');
  let difference = 0;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) difference += Math.abs(a.data[offset + channel] - b.data[offset + channel]);
  }
  return difference / (a.width * a.height * 3);
}

/**
 * 点击真实入口期间由原生驱动逐帧截屏；基准约束起点、终点和中途真实像素。
 * @param device - 安装固定补丁驱动的模拟器。
 * @param name - 本次具体动画效果的基准前缀。
 * @param testInfo - Playwright 测试报告。
 * @param region - 排除无关页面变化的完整动画绘制范围。
 * @param trigger - 使用独立 ADB 连接执行实际点击，避免阻塞截图命令。
 */
export async function captureNativeTransition(device: AndroidDevice, name: string, testInfo: TestInfo,
  region: ScreenshotBounds, trigger: () => void): Promise<void> {
  /**
   * 截出固定的动画绘制区域。
   * @param bytes - 原生完整屏幕 PNG。
   */
  const crop = (bytes: Buffer) => motionParts(bytes, [region]).regions[0];
  const before = crop(await gameScreenshot(device));
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<NativeFrame[]> } } })._connection.toImpl(device);
  const timeout = new AbortController();
  let frames: NativeFrame[];
  try {
    const pending = Promise.race([
      implementation._send('motionFrames'),
      setTimeout(30_000, undefined, { signal: timeout.signal }).then(() => { throw new Error('原生动画采样超时。'); }),
    ]);
    await setTimeout(300);
    trigger();
    frames = await pending;
  } finally { timeout.abort(); }
  expect(frames.length, '原生驱动至少采集三帧').toBeGreaterThanOrEqual(3);
  const timeline = frames.map(frame => crop(Buffer.from(frame.png, 'base64')));
  const after = crop(await gameScreenshot(device));
  await testInfo.attach(`${name}-timeline`, {
    body: JSON.stringify(frames.map(({ capturedAt }) => capturedAt)), contentType: 'application/json',
  });
  expect(samePixels(timeline[0], before), '开始采样时动画尚未触发').toBe(true);
  expect(samePixels(timeline.at(-1)!, after), '采样结束时动画必须完成').toBe(true);
  const total = frameColorDistance(before, after);
  expect(total, '入口点击必须产生足够大的可见变化').toBeGreaterThan(3);
  const candidates = timeline.map((frame, index) => ({ frame, index, progress: frameColorDistance(before, frame) / total }))
    .filter(item => item.progress > 0.15 && item.progress < 0.85);
  expect(candidates.length, '必须采到起点和终点之间的真实动画帧').toBeGreaterThan(0);
  const middle = candidates.reduce((best, item) => Math.abs(item.progress - 0.5) < Math.abs(best.progress - 0.5) ? item : best);
  await testInfo.attach(`${name}-start`, { body: before, contentType: 'image/png' });
  await testInfo.attach(`${name}-middle`, { body: middle.frame, contentType: 'image/png' });
  await testInfo.attach(`${name}-end`, { body: after, contentType: 'image/png' });
  await testInfo.attach(`${name}-progress`, {
    body: JSON.stringify({ total, middle: middle.index, progress: middle.progress,
      frames: timeline.map(frame => frameColorDistance(before, frame) / total) }), contentType: 'application/json',
  });
  if (testInfo.config.updateSnapshots === 'all') {
    expect(before).toMatchSnapshot(`${name}-start.png`);
    expect(middle.frame).toMatchSnapshot(`${name}-middle.png`);
    expect(after).toMatchSnapshot(`${name}-end.png`);
  } else {
    expect(samePixels(before, readFileSync(testInfo.snapshotPath(`${name}-start.png`))), '动画起点视觉回归').toBe(true);
    expect(samePixels(after, readFileSync(testInfo.snapshotPath(`${name}-end.png`))), '动画终点视觉回归').toBe(true);
    const reference = readFileSync(testInfo.snapshotPath(`${name}-middle.png`));
    expect(Math.min(...candidates.map(item => frameColorDistance(item.frame, reference))),
      '动画中间关键帧的真实像素须匹配基准').toBeLessThanOrEqual(12);
  }
}
