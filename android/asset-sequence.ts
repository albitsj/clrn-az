import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { frameColorDistance } from './animation-transition';
import { gameScreenshot } from './game-controls';
import { motionParts, samePixels } from './motion-regions';
import type { ScreenshotBounds } from './screenshot';

type NativeFrame = { capturedAt: number; png: string };

/**
 * 真实房间消息触发的短 WebP 效果：记录静态背景和两张不同的播放关键帧。
 * @param device - 已连接的原生模拟器。
 * @param name - 素材和动效名称。
 * @param info - 测试报告和快照位置。
 * @param region - 效果在屏幕上的绘制区域。
 * @param trigger - 实际发送房间消息的操作。
 */
export async function captureAssetSequence(device: AndroidDevice, name: string, info: TestInfo,
  region: ScreenshotBounds, trigger: () => Promise<unknown>): Promise<void> {
  /**
   * 从完整原生截图中裁出效果范围。
   * @param bytes - 原生截图 PNG。
   */
  const crop = (bytes: Buffer) => motionParts(bytes, [region]).regions[0];
  const before = crop(await gameScreenshot(device));
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<NativeFrame[]> } } })._connection.toImpl(device);
  const pending = implementation._send('motionFrames');
  await setTimeout(300);
  await trigger();
  const timeline = (await pending).map(frame => crop(Buffer.from(frame.png, 'base64')));
  expect(timeline.length).toBeGreaterThanOrEqual(10);
  expect(samePixels(before, timeline[0]), `${name} 必须在采样开始后播放`).toBe(true);
  const visible = timeline.map((frame, index) => ({ frame, index, distance: frameColorDistance(before, frame) }))
    .filter(item => item.distance > 2);
  expect(visible.length, `${name} 必须在屏幕上实际出现`).toBeGreaterThanOrEqual(2);
  const peak = visible.reduce((best, item) => item.distance > best.distance ? item : best);
  const changed = visible.reduce((best, item) => frameColorDistance(peak.frame, item.frame)
    > frameColorDistance(peak.frame, best.frame) ? item : best);
  expect(frameColorDistance(peak.frame, changed.frame), `${name} 播放帧必须实际变化`).toBeGreaterThan(2);
  await info.attach(`${name}-timeline`, { body: JSON.stringify({ peak: peak.index, changed: changed.index,
    distances: timeline.map(frame => frameColorDistance(before, frame)) }), contentType: 'application/json' });
  for (const [phase, frame] of [['start', before], ['peak', peak.frame], ['changed', changed.frame]] as const) {
    const file = `${name}-${phase}.png`;
    await info.attach(file, { body: frame, contentType: 'image/png' });
    if (info.config.updateSnapshots === 'all') expect(frame).toMatchSnapshot(file);
    else {
      const reference = readFileSync(info.snapshotPath(file));
      expect(Math.min(...(phase === 'start' ? [before] : visible.map(item => item.frame))
        .map(candidate => frameColorDistance(candidate, reference))), `${name} ${phase} 视觉回归`)
        .toBeLessThanOrEqual(15);
    }
  }
  await setTimeout(2500);
  expect(samePixels(before, crop(await gameScreenshot(device))), `${name} 须播放结束并恢复画面`).toBe(true);
}
