import { readFileSync } from 'node:fs';
import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { PNG } from 'pngjs';
import { frameColorDistance } from './animation-transition';
import { motionParts } from './motion-regions';
import type { ScreenshotBounds } from './screenshot';

type NativeFrame = { capturedAt: number; png: string };

/**
 * 单个动态区域的平均亮度，用于从真实动画轨迹选择两端相位。
 * @param bytes - 裁切后的原生 PNG。
 */
function brightness(bytes: Buffer): number {
  const png = PNG.sync.read(bytes);
  let sum = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    sum += (png.data[index] + png.data[index + 1] + png.data[index + 2]) / 3;
  }
  return sum / (png.width * png.height);
}

/**
 * 对循环脉动的每个独立控件保存明暗两端真实屏幕关键帧。
 * @param device - 已安装固定原生采样驱动的模拟器。
 * @param name - 具体动画名称。
 * @param testInfo - Playwright 快照与报告。
 * @param regions - 每个独立脉动占位控件的可见范围。
 */
export async function captureLoopKeyframes(device: AndroidDevice, name: string, testInfo: TestInfo,
  regions: ScreenshotBounds[]): Promise<void> {
  expect(regions.length).toBeGreaterThan(0);
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<NativeFrame[]> } } })._connection.toImpl(device);
  const timeline = await implementation._send('motionFrames');
  expect(timeline.length).toBeGreaterThanOrEqual(10);
  await testInfo.attach(`${name}-timeline`, {
    body: JSON.stringify(timeline.map(({ capturedAt }) => capturedAt)), contentType: 'application/json',
  });
  const pictures = timeline.map(frame => motionParts(Buffer.from(frame.png, 'base64'), regions).regions);
  for (const index of regions.keys()) {
    const frames = pictures.map(parts => parts[index]);
    const phases = frames.map((frame, position) => ({ frame, position, light: brightness(frame) }));
    const dark = phases.reduce((best, item) => item.light < best.light ? item : best);
    const light = phases.reduce((best, item) => item.light > best.light ? item : best);
    expect(light.light - dark.light, `${name} 第 ${index + 1} 个占位控件必须脉动`).toBeGreaterThan(0.5);
    await testInfo.attach(`${name}-${index + 1}-phases`, {
      body: JSON.stringify({ dark: dark.position, light: light.position, delta: light.light - dark.light }),
      contentType: 'application/json',
    });
    for (const [phase, selected] of [['dark', dark], ['light', light]] as const) {
      await testInfo.attach(`${name}-${index + 1}-${phase}`, { body: selected.frame, contentType: 'image/png' });
      const file = `${name}-${index + 1}-${phase}.png`;
      if (testInfo.config.updateSnapshots === 'all') expect(selected.frame).toMatchSnapshot(file);
      else expect(Math.min(...frames.map(frame => frameColorDistance(frame, readFileSync(testInfo.snapshotPath(file))))),
        `${name} 第 ${index + 1} 个控件的${phase}相位须匹配基准`).toBeLessThanOrEqual(10);
    }
  }
}

/**
 * 对位置变化而亮度几乎不变的循环动画保存两种真实画面，并在回归时逐帧寻找对应相位。
 * @param device - 已安装固定原生采样驱动的模拟器。
 * @param name - 具体动画名称。
 * @param testInfo - Playwright 快照与报告。
 * @param regions - 每个独立运动控件的完整可见范围。
 * @param distanceLimit - 随机图案循环的允许色差，固定外观动画使用默认值。
 */
export async function captureMovingKeyframes(device: AndroidDevice, name: string, testInfo: TestInfo,
  regions: ScreenshotBounds[], distanceLimit = 18): Promise<void> {
  expect(regions.length).toBeGreaterThan(0);
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<NativeFrame[]> } } })._connection.toImpl(device);
  const timeline = await implementation._send('motionFrames');
  expect(timeline.length).toBeGreaterThanOrEqual(10);
  const pictures = timeline.map(frame => motionParts(Buffer.from(frame.png, 'base64'), regions).regions);
  for (const index of regions.keys()) {
    const frames = pictures.map(parts => parts[index]);
    const first = frames[0];
    const distances = frames.map(frame => frameColorDistance(first, frame));
    const farthestIndex = distances.indexOf(Math.max(...distances));
    expect(distances[farthestIndex], `${name} 第 ${index + 1} 个控件必须运动`).toBeGreaterThan(1);
    for (const [phase, selected] of [['first', first], ['moved', frames[farthestIndex]]] as const) {
      const file = `${name}-${index + 1}-${phase}.png`;
      await testInfo.attach(file, { body: selected, contentType: 'image/png' });
      if (testInfo.config.updateSnapshots === 'all') expect(selected).toMatchSnapshot(file);
      else {
        const reference = readFileSync(testInfo.snapshotPath(file));
        expect(Math.min(...frames.map(frame => frameColorDistance(frame, reference))),
          `${name} 第 ${index + 1} 个控件的${phase}相位须匹配基准`).toBeLessThanOrEqual(distanceLimit);
      }
    }
  }
}
