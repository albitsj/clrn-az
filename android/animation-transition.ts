/** 采集并比较原生转场，所有相位使用同一次解析的完整绘制边界。 */
import { requireEnglishAnimation } from './animation-locale';
import { comparePhaseSnapshot } from './animation-transition-comparison';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { gameScreenshot } from './game-controls';
import { motionParts, samePixels } from './motion-regions';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { recordNativeVideoFrames, type AnimationRegion } from './video-frames';
import { frameColorDistance, framePaletteDistance } from './animation-transition-metrics';
import { NativeTransition } from './animation-transition-capture';
import { withDefault } from './animation-transition-options';
export { frameColorDistance, framePaletteDistance, middleCandidates, assertReviewedVideoMiddle } from './animation-transition-metrics';
type NativeFrame = { capturedAt: number; png: string };

/**
 * 点击真实入口期间由原生驱动逐帧截屏；基准约束起点、终点和中途真实像素。
 * @param device - 安装固定补丁驱动的模拟器。
 * @param name - 本次具体动画效果的基准前缀。
 * @param testInfo - Playwright 测试报告。
 * @param region - 完整绘制范围，入场弹窗可在采样完成后读取实际控件边界。
 * @param trigger - 使用独立 ADB 连接执行实际点击，避免阻塞截图命令。
 * @param masks - 区域内与目标无关的独立循环效果；保留掩码说明。
 * @param requiredRegions - 同一效果中必须分别运动的可见子区域。
 * @param settleMs - 触发后仍在滚动的长动画，采样结束后额外等待完成。
 * @param samplingMethod - 启动页、延迟弹窗或短于截屏间隔的转场使用对应采样命令。
 * @param inspectFrames - 对同一组原生帧中的独立子动画追加视觉断言。
 * @param afterReady - 需要异步业务数据的面板在终点截图前等待语义就绪。
 * @param videoPhaseAnchors - 独立绘制层可在不同顺序呈现的额外已审查录屏相位。
 * @param endCompareMasks - 终点独立数值区域；原始终点仍保留在报告中供审查。
 * @param startPhaseAnchors - 系统启动器布局不同但均已审查的起点画面。
 * @param startCompareMasks - 仅用于比较触发前桌面帧的系统动态图标区域；坐标相对截图裁切范围。
 * @param videoRecorder - 可替换的原生录屏采集器，供完整录屏路径回归测试使用。
 * @param observe - 仅记录阶段时间，不执行设备查询或等待。
 */
export async function captureNativeTransition(device: AndroidDevice, name: string, testInfo: TestInfo,
  region: AnimationRegion, trigger: () => unknown, masks?: ScreenshotMask[],
  requiredRegions?: ScreenshotBounds[], settleMs?: number,
  samplingMethod?: 'motionFrames' | 'launchFrames' | 'videoFrames',
  inspectFrames?: (frames: Buffer[], testInfo: TestInfo) => Promise<void>,
  afterReady?: () => Promise<void>, videoPhaseAnchors?: string[],
  endCompareMasks?: ScreenshotMask[],
  startPhaseAnchors?: string[], startCompareMasks?: ScreenshotMask[],
  videoRecorder?: typeof recordNativeVideoFrames,
  observe?: (event: string) => void): Promise<void> {
  await new NativeTransition({ device, name, testInfo, region, trigger,
    masks: withDefault(masks, []), requiredRegions: withDefault(requiredRegions, []),
    settleMs: withDefault(settleMs, 0), samplingMethod: withDefault(samplingMethod, 'motionFrames'),
    inspectFrames, afterReady, videoPhaseAnchors: withDefault(videoPhaseAnchors, []),
    endCompareMasks: withDefault(endCompareMasks, []), startPhaseAnchors: withDefault(startPhaseAnchors, []),
    startCompareMasks: withDefault(startCompareMasks, []), videoRecorder: withDefault(videoRecorder, recordNativeVideoFrames),
    observe }).capture();
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
  requireEnglishAnimation();
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
  await attachTimeline();
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
    await comparePhase(phase, frame);
  }
  /** 报告所有原始短时提示相位。 */
  async function attachTimeline(): Promise<void> {
    for (const [index, frame] of frames.entries()) {
      await testInfo.attach(`${name}-frame-${index}`, { body: frame, contentType: 'image/png' });
    }
  }
  /** 附加真实提示相位并比较原有关键帧容差。
   * @param phase - 相位名称。
   * @param frame - 实际截图。
   */
  async function comparePhase(phase: string, frame: Buffer): Promise<void> {
    await comparePhaseSnapshot(testInfo, `${name}-${phase}.png`, frame, reference => {
      expect(Math.min(...(phase === 'start' ? [before] : frames)
        .map(candidate => frameColorDistance(candidate, reference))),
      `${name} ${phase} 视觉关键帧须匹配基准`).toBeLessThanOrEqual(12);
    });
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
  requireEnglishAnimation();
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
  const pair = countdownPair(settled);
  expect(pair, `${name} 标题稳定后倒计时数字必须变化`).toBeDefined();
  await setTimeout(6000);
  const after = crop(await gameScreenshot(device));
  expect(samePixels(after, before), `${name} 倒计时结束后须恢复画面`).toBe(true);
  for (const [phase, frame] of [['start', before], ['visible', pair!.first],
    ['countdown', pair!.changed], ['end', after]] as const) {
    await comparePhase(phase, frame);
  }
  /** 首尾严格匹配，其余提示相位使用原有色差阈值。
   * @param phase - 相位名称。
   * @param frame - 实际截图。
   */
  async function comparePhase(phase: string, frame: Buffer): Promise<void> {
    await comparePhaseSnapshot(testInfo, `${name}-${phase}.png`, frame, reference => {
      if (['start', 'end'].includes(phase)) expect(samePixels(frame, reference)).toBe(true);
      else expect(Math.min(...visible.map(candidate => frameColorDistance(candidate, reference))),
        `${name} ${phase} 视觉回归`).toBeLessThanOrEqual(12);
    });
  }
}

/** 寻找标题稳定但秒数变化的首对真实画面。
 * @param settled - 标题完整出现后的候选相位。
 */
function countdownPair(settled: { frame: Buffer; heading: Buffer; seconds: Buffer }[]) {
  for (let index = 0; index < settled.length; index++) {
    const first = settled[index];
    const changed = settled.slice(index + 1).find(item => frameColorDistance(first.heading, item.heading) < 3
      && frameColorDistance(first.seconds, item.seconds) > 4);
    if (changed) return { first: first.frame, changed: changed.frame };
  }
}
