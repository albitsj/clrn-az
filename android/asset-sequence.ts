import { requireEnglishAnimation } from './animation-locale';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { frameColorDistance, framePaletteDistance } from './animation-transition';
import { gameConnected, gameScreenshot } from './game-controls';
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
 * @param flightRegion - 道具从发送者飞向目标时经过的区域。
 */
export async function captureAssetSequence(device: AndroidDevice, name: string, info: TestInfo,
  region: ScreenshotBounds, trigger: () => Promise<unknown>, flightRegion?: ScreenshotBounds): Promise<void> {
  requireEnglishAnimation();
  /**
   * 从完整原生截图中裁出效果范围。
   * @param bytes - 原生截图 PNG。
   */
  const crop = (bytes: Buffer) => motionParts(bytes, [region]).regions[0];
  await gameConnected(device, 1_000);
  let beforeScreen = await gameScreenshot(device);
  let before = crop(beforeScreen);
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<NativeFrame[]> } } })._connection.toImpl(device);
  let screens: Buffer[] = [];
  let timeline: Buffer[] = [];
  let visible: { frame: Buffer; index: number; distance: number }[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = implementation._send('motionFrames');
    await setTimeout(300);
    await trigger();
    screens = (await pending).map(frame => Buffer.from(frame.png, 'base64'));
    timeline = screens.map(crop);
    expect(timeline.length).toBeGreaterThanOrEqual(10);
    expect(samePixels(before, timeline[0]), `${name} 必须在采样开始后播放`).toBe(true);
    visible = timeline.map((frame, index) => ({ frame, index, distance: frameColorDistance(before, frame) }))
      .filter(item => item.distance > 2);
    if (visible.length >= 2 || attempt) break;
    // 消息到达后短时采样可能先于原生素材绘制；保留原画面，再重新触发同一效果。
    await info.attach(`${name}-首次未显示`, { body: screens.at(-1)!, contentType: 'image/png' });
    await setTimeout(2500);
    await gameConnected(device, 2_000);
    beforeScreen = await gameScreenshot(device);
    expect(samePixels(before, crop(beforeScreen)), `${name} 重新触发前须恢复静态画面`).toBe(true);
    before = crop(beforeScreen);
  }
  expect(visible.length, `${name} 必须在屏幕上实际出现`).toBeGreaterThanOrEqual(2);
  const peak = visible.reduce((best, item) => item.distance > best.distance ? item : best);
  const changed = visible.reduce((best, item) => frameColorDistance(peak.frame, item.frame)
    > frameColorDistance(peak.frame, best.frame) ? item : best);
  // 小尺寸表情的口型只占裁切区一角，平均色差仍须明确大于静止噪声。
  expect(frameColorDistance(peak.frame, changed.frame), `${name} 播放帧必须实际变化`).toBeGreaterThan(1);
  await info.attach(`${name}-timeline`, { body: JSON.stringify({ peak: peak.index, changed: changed.index,
    distances: timeline.map(frame => frameColorDistance(before, frame)) }), contentType: 'application/json' });
  for (const [phase, frame] of [['start', before], ['peak', peak.frame], ['changed', changed.frame]] as const) {
    const file = `${name}-${phase}.png`;
    await info.attach(file, { body: frame, contentType: 'image/png' });
    if (info.config.updateSnapshots === 'all') expect(frame).toMatchSnapshot(file);
    else {
      const references = [readFileSync(info.snapshotPath(file))];
      const alternate = info.snapshotPath(`${name}-${phase}-alternate.png`);
      if (phase !== 'start' && existsSync(alternate)) references.push(readFileSync(alternate));
      // 飞行道具在接收者身上经过的时刻可变；颜色构成锁定素材，下面的飞行区域另锁定位置。
      const compare = flightRegion && phase !== 'start' ? framePaletteDistance : frameColorDistance;
      expect(Math.min(...(phase === 'start' ? [before] : visible.map(item => item.frame))
        .flatMap(candidate => references.map(reference => compare(candidate, reference)))),
      `${name} ${phase} 视觉回归`)
        .toBeLessThanOrEqual(15);
    }
  }
  await setTimeout(2500);
  expect(samePixels(before, crop(await gameScreenshot(device))), `${name} 须播放结束并恢复画面`).toBe(true);
  if (flightRegion) {
    /**
     * 裁切道具经过的中途路线，独立锁定飞行轨迹。
     * @param bytes - 原生完整屏幕 PNG。
     */
    const flight = (bytes: Buffer) => motionParts(bytes, [flightRegion]).regions[0];
    const flightStart = flight(beforeScreen);
    const flightFrames = screens.map(flight);
    const moving = flightFrames.map((frame, index) => ({ frame, index,
      distance: frameColorDistance(flightStart, frame) })).filter(item => item.distance > 1);
    expect(moving.length, `${name} 道具必须飞过目标路线`).toBeGreaterThanOrEqual(2);
    const farthest = moving.reduce((best, item) => item.distance > best.distance ? item : best);
    const alternate = moving.reduce((best, item) => frameColorDistance(farthest.frame, item.frame)
      > frameColorDistance(farthest.frame, best.frame) ? item : best);
    expect(frameColorDistance(farthest.frame, alternate.frame), `${name} 飞行位置必须变化`).toBeGreaterThan(1);
    for (const [phase, frame] of [['start', flightStart], ['peak', farthest.frame],
      ['changed', alternate.frame]] as const) {
      const file = `${name}-flight-${phase}.png`;
      await info.attach(file, { body: frame, contentType: 'image/png' });
      if (info.config.updateSnapshots === 'all') expect(frame).toMatchSnapshot(file);
      else {
        const references = [readFileSync(info.snapshotPath(file))];
        const alternate = info.snapshotPath(`${name}-flight-${phase}-alternate.png`);
        if (phase !== 'start' && existsSync(alternate)) references.push(readFileSync(alternate));
        const secondAlternate = info.snapshotPath(`${name}-flight-${phase}-alternate-2.png`);
        if (phase !== 'start' && existsSync(secondAlternate)) references.push(readFileSync(secondAlternate));
        expect(Math.min(...(phase === 'start' ? [flightStart] : moving.map(item => item.frame))
          .flatMap(candidate => references.map(reference => frameColorDistance(candidate, reference)))),
        `${name} 飞行 ${phase} 视觉回归`)
          .toBeLessThanOrEqual(15);
      }
    }
  }
}
