import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { AndroidDevice } from 'playwright';
import { gameScreenshot } from './game-controls';
import { motionParts, samePixels } from './motion-regions';
import { maskScreenshot, type ScreenshotBounds, type ScreenshotMask } from './screenshot';
import { recordNativeVideoFrames } from './video-frames';

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

/** 平移弹层的颜色分布距离；保留配色与覆盖比例，允许同一幅画面处在不同纵向位置。
 * @param left - 第一张局部 PNG。
 * @param right - 第二张局部 PNG。
 */
export function framePaletteDistance(left: Buffer, right: Buffer): number {
  const a = PNG.sync.read(left), b = PNG.sync.read(right);
  if (a.width !== b.width || a.height !== b.height) throw new Error('动画帧尺寸变化');
  let difference = 0;
  for (let channel = 0; channel < 3; channel++) {
    const counts = new Int32Array(256);
    for (let offset = channel; offset < a.data.length; offset += 4) {
      counts[a.data[offset]]++;
      counts[b.data[offset]]--;
    }
    let balance = 0;
    for (const count of counts) { balance += count; difference += Math.abs(balance); }
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
 * @param masks - 区域内与目标无关的独立循环效果；保留掩码说明。
 * @param requiredRegions - 同一效果中必须分别运动的可见子区域。
 * @param settleMs - 触发后仍在滚动的长动画，采样结束后额外等待完成。
 * @param samplingMethod - 启动页、延迟弹窗或短于截屏间隔的转场使用对应采样命令。
 * @param inspectFrames - 对同一组原生帧中的独立子动画追加视觉断言。
 * @param afterReady - 需要异步业务数据的面板在终点截图前等待语义就绪。
 * @param videoPhaseAnchors - 独立绘制层可在不同顺序呈现的额外已审查录屏相位。
 */
export async function captureNativeTransition(device: AndroidDevice, name: string, testInfo: TestInfo,
  region: ScreenshotBounds, trigger: () => unknown, masks: ScreenshotMask[] = [],
  requiredRegions: ScreenshotBounds[] = [], settleMs = 0,
  samplingMethod: 'motionFrames' | 'launchFrames' | 'videoFrames' = 'motionFrames',
  inspectFrames?: (frames: Buffer[], testInfo: TestInfo) => Promise<void>,
  afterReady?: () => Promise<void>, videoPhaseAnchors: string[] = []): Promise<void> {
  /**
   * 截出固定的动画绘制区域。
   * @param bytes - 原生完整屏幕 PNG。
   */
  const crop = (bytes: Buffer) => motionParts(maskScreenshot(bytes, masks), [region]).regions[0];
  if (masks.length) await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  const before = crop(await gameScreenshot(device));
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<NativeFrame[]> } } })._connection.toImpl(device);
  const timeout = new AbortController();
  let frames: NativeFrame[];
  if (samplingMethod === 'videoFrames') {
    if (requiredRegions.length) throw new Error('录屏转场需单独定义不含子区域的绘制范围。');
    frames = (await recordNativeVideoFrames(name, region, trigger, testInfo))
      .map((png, index) => ({ capturedAt: index * 33, png: png.toString('base64') }));
  } else {
    try {
      const pending = Promise.race([
        implementation._send(samplingMethod),
        setTimeout(30_000, undefined, { signal: timeout.signal }).then(() => { throw new Error('原生动画采样超时。'); }),
      ]);
      await setTimeout(300);
      await trigger();
      frames = await pending;
    } finally { timeout.abort(); }
  }
  expect(frames.length, '原生驱动至少采集三帧').toBeGreaterThanOrEqual(3);
  const originals = frames.map(frame => Buffer.from(frame.png, 'base64'));
  if (inspectFrames) await inspectFrames(originals, testInfo);
  const timeline = samplingMethod === 'videoFrames'
    ? originals.map(frame => maskScreenshot(frame, masks.map(mask => ({ ...mask,
      x: mask.x - region.x, y: mask.y - region.y })))) : originals.map(crop);
  if (settleMs) await setTimeout(settleMs);
  if (afterReady) await afterReady();
  const after = crop(await gameScreenshot(device));
  await testInfo.attach(`${name}-timeline`, {
    body: JSON.stringify(frames.map(({ capturedAt }) => capturedAt)), contentType: 'application/json',
  });
  for (const [index, frame] of timeline.entries()) {
    if (samplingMethod === 'videoFrames' && index % 5 !== 0 && index !== timeline.length - 1) continue;
    await testInfo.attach(`${name}-frame-${index}`, { body: frame, contentType: 'image/png' });
  }
  await testInfo.attach(`${name}-start`, { body: before, contentType: 'image/png' });
  await testInfo.attach(`${name}-end`, { body: after, contentType: 'image/png' });
  if (samplingMethod === 'videoFrames') {
    // 半分辨率录屏的双线性放大使牌面边缘逐像素差约为 8–11；首尾仍须保持相同色彩面积。
    expect(framePaletteDistance(timeline[0], before), '录屏开始时动画尚未触发').toBeLessThan(7);
    if (!settleMs && !afterReady) expect(framePaletteDistance(timeline.at(-1)!, after), '录屏结束时动画必须完成').toBeLessThan(7);
  } else {
    expect(samePixels(timeline[0], before), '开始采样时动画尚未触发').toBe(true);
    if (!settleMs && !afterReady) expect(samePixels(timeline.at(-1)!, after), '采样结束时动画必须完成').toBe(true);
  }
  if (requiredRegions.length) {
    const parts = originals.map(frame => motionParts(maskScreenshot(frame, masks), requiredRegions).regions);
    for (const index of requiredRegions.keys()) {
      expect(parts.some(sample => !samePixels(sample[index], parts[0][index])),
        `${name} 第 ${index + 1} 个区域必须独立运动`).toBe(true);
    }
  }
  const total = frameColorDistance(before, after);
  expect(total, '入口点击必须产生足够大的可见变化').toBeGreaterThan(3);
  // BottomSheet 的弹簧轨迹可能越过终点；用“同时区别于首尾”选关键帧。
  const candidates = timeline.map((frame, index) => ({ frame, index,
    progress: frameColorDistance(before, frame) / total,
    remaining: frameColorDistance(after, frame) / total }))
    // 200ms 的原生淡入有时只采到靠近终点的一帧，仍要求它与两个端点都有实际像素差。
    .filter(item => item.progress > 0.02 && item.remaining > 0.02
      && frameColorDistance(before, item.frame) > (samplingMethod === 'videoFrames' ? 7 : 1)
      && frameColorDistance(after, item.frame) > (samplingMethod === 'videoFrames' ? 7 : 1));
  await testInfo.attach(`${name}-progress`, {
    body: JSON.stringify({ total, frames: timeline.map(frame => frameColorDistance(before, frame) / total) }),
    contentType: 'application/json',
  });
  expect(candidates.length, '必须采到起点和终点之间的真实动画帧').toBeGreaterThan(0);
  const middle = candidates.reduce((best, item) => Math.min(item.progress, item.remaining)
    > Math.min(best.progress, best.remaining) ? item : best);
  await testInfo.attach(`${name}-middle`, { body: middle.frame, contentType: 'image/png' });
  await testInfo.attach(`${name}-middle-progress`, {
    body: JSON.stringify({ index: middle.index, progress: middle.progress, remaining: middle.remaining }),
    contentType: 'application/json',
  });
  if (testInfo.config.updateSnapshots === 'all') {
    expect(before).toMatchSnapshot(`${name}-start.png`);
    expect(middle.frame).toMatchSnapshot(`${name}-middle.png`);
    expect(after).toMatchSnapshot(`${name}-end.png`);
  } else {
    expect(samePixels(before, readFileSync(testInfo.snapshotPath(`${name}-start.png`))), '动画起点视觉回归').toBe(true);
    expect(samePixels(after, readFileSync(testInfo.snapshotPath(`${name}-end.png`))), '动画终点视觉回归').toBe(true);
    const reference = readFileSync(testInfo.snapshotPath(`${name}-middle.png`));
    // 系统截图间隔约 70–180ms；短动画有时仅采到靠近起点或终点的帧。
    // 起止帧逐像素匹配，独立断言中途帧真实可见，再要求它靠近已审查的轨迹锚点。
    const anchors = samplingMethod === 'videoFrames'
      ? [reference, ...videoPhaseAnchors.map(file => readFileSync(testInfo.snapshotPath(file)))]
      : [before, reference, after];
    const compare = samplingMethod === 'videoFrames' ? framePaletteDistance : frameColorDistance;
    expect(Math.min(...candidates.flatMap(item => anchors.map(anchor => compare(item.frame, anchor)))),
      '动画中途帧的实际画面须接近已审查轨迹').toBeLessThanOrEqual(samplingMethod === 'videoFrames' ? 30 : 36);
  }
}

/**
 * 对显示后又消失的提示保存起点、半透明帧和最清晰帧，校验真实入退场轨迹。
 * @param device - 安装固定原生采样驱动的模拟器。
 * @param name - 短时效果名称。
 * @param testInfo - Playwright 快照与报告。
 * @param region - 提示绘制范围，排除其他动态元素。
 * @param trigger - 从独立代理或 ADB 触发提示。
 * @param settleMs - 提示结束后等待画面恢复的时间。
 */
export async function captureTransientTransition(device: AndroidDevice, name: string, testInfo: TestInfo,
  region: ScreenshotBounds, trigger: () => unknown, settleMs = 2500): Promise<void> {
  /**
   * 从完整原生截图裁切提示区域。
   * @param bytes - 原生完整屏幕 PNG。
   */
  const crop = (bytes: Buffer) => motionParts(bytes, [region]).regions[0];
  const before = crop(await gameScreenshot(device));
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<NativeFrame[]> } } })._connection.toImpl(device);
  const pending = implementation._send('motionFrames');
  await setTimeout(300);
  await trigger();
  const frames = (await pending).map(frame => crop(Buffer.from(frame.png, 'base64')));
  expect(frames.length).toBeGreaterThanOrEqual(10);
  await setTimeout(settleMs);
  const after = crop(await gameScreenshot(device));
  for (const [index, frame] of frames.entries()) {
    await testInfo.attach(`${name}-frame-${index}`, { body: frame, contentType: 'image/png' });
  }
  expect(samePixels(frames[0], before), '短时提示须在采样开始后出现').toBe(true);
  expect(samePixels(before, after), '短时提示应自动消失并恢复原画面').toBe(true);
  const phases = frames.map(frame => ({ frame, distance: frameColorDistance(before, frame) }));
  const peak = phases.reduce((best, item) => item.distance > best.distance ? item : best);
  expect(peak.distance, '短时提示必须产生明显可见变化').toBeGreaterThan(3);
  const middle = phases.filter(item => item.distance > 1 && item.distance < peak.distance - 1)
    .reduce((best, item) => Math.abs(item.distance - peak.distance / 2)
      < Math.abs(best.distance - peak.distance / 2) ? item : best, phases[0]);
  expect(middle.distance, '短时提示须采到半透明动画帧').toBeGreaterThan(1);
  for (const [phase, frame] of [['start', before], ['middle', middle.frame], ['peak', peak.frame]] as const) {
    const file = `${name}-${phase}.png`;
    await testInfo.attach(file, { body: frame, contentType: 'image/png' });
    if (testInfo.config.updateSnapshots === 'all') expect(frame).toMatchSnapshot(file);
    else {
      const reference = readFileSync(testInfo.snapshotPath(file));
      expect(Math.min(...(phase === 'start' ? [before] : frames)
        .map(candidate => frameColorDistance(candidate, reference))),
      `${name} ${phase} 视觉关键帧须匹配基准`).toBeLessThanOrEqual(12);
    }
  }
}

/**
 * 带秒数的自动消失提示：保存出现前、两种倒计时画面与消失后，逐帧确认实际计时变化。
 * @param device - 安装原生采样驱动的模拟器。
 * @param name - 提示的视觉基线名称。
 * @param testInfo - Playwright 报告与快照。
 * @param region - 包含提示文字和倒计时、排除网络延迟的屏幕范围。
 * @param trigger - 点击真实按钮以触发提示。
 */
export async function captureTimedPrompt(device: AndroidDevice, name: string, testInfo: TestInfo,
  region: ScreenshotBounds, trigger: () => unknown): Promise<void> {
  /**
   * 裁切固定上方面板。
   * @param bytes - 原生完整屏幕 PNG。
   */
  const crop = (bytes: Buffer) => motionParts(bytes, [region]).regions[0];
  const before = crop(await gameScreenshot(device));
  const frames = await recordNativeVideoFrames(name, region, trigger, testInfo);
  expect(frames.length).toBeGreaterThanOrEqual(20);
  expect(framePaletteDistance(before, frames[0]), `${name} 须在采样开始后出现`).toBeLessThan(7);
  const visible = frames.filter(frame => frameColorDistance(before, frame) > 15);
  expect(visible.length, `${name} 须实际显示`).toBeGreaterThanOrEqual(2);
  /**
   * 只截完整提示标题。
   * @param frame - 顶部提示区域的截图。
   */
  const title = (frame: Buffer) => motionParts(frame, [{ x: 80, y: 45, width: 520, height: 110 }]).regions[0];
  /**
   * 只截底部秒数，避免把提示滑入误认为倒计时。
   * @param frame - 顶部提示区域的截图。
   */
  const timer = (frame: Buffer) => motionParts(frame, [{ x: 0, y: 165, width: 70, height: 45 }]).regions[0];
  const beforeTitle = title(before);
  const settled = visible.map(frame => ({ frame, heading: title(frame), seconds: timer(frame) }))
    .filter(item => frameColorDistance(beforeTitle, item.heading) > 30);
  expect(settled.length, `${name} 标题须完整出现`).toBeGreaterThanOrEqual(2);
  let pair: { first: Buffer; changed: Buffer } | undefined;
  for (let index = 0; index < settled.length && !pair; index++) {
    const first = settled[index];
    const changed = settled.slice(index + 1).find(item =>
      frameColorDistance(first.heading, item.heading) < 3
      && frameColorDistance(first.seconds, item.seconds) > 4);
    if (changed) pair = { first: first.frame, changed: changed.frame };
  }
  expect(pair, `${name} 标题稳定后倒计时数字必须变化`).toBeDefined();
  await setTimeout(6000);
  const after = crop(await gameScreenshot(device));
  expect(samePixels(after, before), `${name} 倒计时结束后须恢复画面`).toBe(true);
  for (const [phase, frame] of [['start', before], ['visible', pair!.first],
    ['countdown', pair!.changed], ['end', after]] as const) {
    const file = `${name}-${phase}.png`;
    await testInfo.attach(file, { body: frame, contentType: 'image/png' });
    if (testInfo.config.updateSnapshots === 'all') expect(frame).toMatchSnapshot(file);
    else if (phase === 'start' || phase === 'end') expect(samePixels(frame, readFileSync(testInfo.snapshotPath(file)))).toBe(true);
    else {
      const reference = readFileSync(testInfo.snapshotPath(file));
      expect(Math.min(...visible.map(candidate => frameColorDistance(candidate, reference))),
        `${name} ${phase} 视觉回归`).toBeLessThanOrEqual(12);
    }
  }
}
