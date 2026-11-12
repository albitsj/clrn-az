import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { requireEnglishAnimation } from './animation-locale';
import { gameScreenshot } from './game-controls';
import { motionParts, samePixels } from './motion-regions';
import { maskScreenshot, type ScreenshotBounds, type ScreenshotMask } from './screenshot';
import { recordNativeVideoFrames, type AnimationRegion } from './video-frames';
import { frameColorDistance, framePaletteDistance, middleCandidates, assertReviewedVideoMiddle } from './animation-transition-metrics';

type NativeFrame = { capturedAt: number; capturedAtEpochMs?: number; png: string };
type Candidate = ReturnType<typeof middleCandidates>[number];
type TransitionOptions = {
  device: AndroidDevice; name: string; testInfo: TestInfo; region: AnimationRegion; trigger: () => unknown;
  masks: ScreenshotMask[]; requiredRegions: ScreenshotBounds[]; settleMs: number;
  samplingMethod: 'motionFrames' | 'launchFrames' | 'videoFrames';
  inspectFrames: ((frames: Buffer[], info: TestInfo) => Promise<void>) | undefined;
  afterReady: (() => Promise<void>) | undefined; videoPhaseAnchors: string[]; endCompareMasks: ScreenshotMask[];
  startPhaseAnchors: string[]; startCompareMasks: ScreenshotMask[]; videoRecorder: typeof recordNativeVideoFrames;
  observe: ((event: string) => void) | undefined;
};

/** 一次原生转场的采样、诊断和视觉检查，共用唯一解析的绘制边界。 */
export class NativeTransition {
  private bounds: ScreenshotBounds | undefined;
  private before!: Buffer;
  private after!: Buffer;
  private originals!: Buffer[];
  private timeline!: Buffer[];
  /** 保存当前采集参数。
   * @param options - 已应用公开默认值的参数。
   */
  constructor(private readonly options: TransitionOptions) {
    this.bounds = typeof options.region === 'function' ? undefined : options.region;
  }
  /** 保留截图、采样、就绪检查和视觉比较的原有顺序。 */
  async capture(): Promise<void> {
    requireEnglishAnimation();
    await this.attachMasks();
    this.observe('start-screenshot-start');
    const originalBefore = await gameScreenshot(this.options.device);
    this.observe('start-screenshot-complete');
    const frames = await this.sample();
    const bounds = await this.resolveRegion();
    await this.attachJSON('region', bounds);
    this.before = this.crop(originalBefore);
    expect(frames.length, '原生驱动至少采集三帧').toBeGreaterThanOrEqual(3);
    this.originals = frames.map(frame => Buffer.from(frame.png, 'base64'));
    await this.inspectFrames();
    this.timeline = this.makeTimeline(bounds);
    await this.waitForEnd();
    this.after = this.crop(await gameScreenshot(this.options.device));
    await this.attachJSON('timeline', frames.map(({ capturedAt }) => capturedAt));
    await this.attachJSON('device-clock', frames.map(({ capturedAt, capturedAtEpochMs }) => ({ capturedAt, capturedAtEpochMs })))
      .catch(() => undefined);
    await this.attachFrames();
    this.assertEndpoints();
    this.assertRequiredRegions();
    await this.compareMotion();
  }
  /** 只解析一次实际控件边界。 */
  private async resolveRegion(): Promise<ScreenshotBounds> {
    const { region } = this.options;
    if (!this.bounds) this.bounds = typeof region === 'function' ? await region() : region;
    return this.bounds;
  }
  /** 裁出同一绘制区域。
   * @param bytes - 原生全屏图。
   */
  private crop(bytes: Buffer): Buffer { return motionParts(maskScreenshot(bytes, this.options.masks), [this.bounds!]).regions[0]; }
  /** 可选阶段记录器不查询设备，也不等待。
   * @param event - 固定阶段名。
   */
  private observe(event: string): void {
    const { observe } = this.options;
    observe?.(event);
  }
  /** 保存 JSON 诊断。
   * @param suffix - 附件后缀。
   * @param value - 诊断数据。
   */
  private async attachJSON(suffix: string, value: unknown): Promise<void> {
    await this.options.testInfo.attach(`${this.options.name}-${suffix}`, { body: JSON.stringify(value), contentType: 'application/json' });
  }
  /** 保存原有遮罩说明。 */
  private async attachMasks(): Promise<void> {
    if (this.options.masks.length) await this.attachJSON('masks', this.options.masks);
    if (this.options.startCompareMasks.length) await this.attachJSON('start-masks', this.options.startCompareMasks);
  }
  /** 取得驱动后分派原生采样或连续录屏，保留视频路径的连接校验。 */
  private async sample(): Promise<NativeFrame[]> {
    const { device, samplingMethod } = this.options;
    const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
      _send(method: string): Promise<NativeFrame[]> } } })._connection.toImpl(device);
    if (samplingMethod === 'videoFrames') return this.sampleVideo();
    return this.sampleNative(implementation);
  }
  /** 延迟边界只在录制后解析；视频时间戳保持原有 33ms 间隔。 */
  private async sampleVideo(): Promise<NativeFrame[]> {
    const { name, region, trigger, testInfo, videoRecorder, requiredRegions } = this.options;
    if (requiredRegions.length) throw new Error('录屏转场需单独定义不含子区域的绘制范围。');
    this.observe('video-recording-start');
    const recordedRegion = typeof region === 'function' ? () => this.resolveRegion() : region;
    return (await videoRecorder(name, recordedRegion, trigger, testInfo))
      .map((png, index) => ({ capturedAt: index * 33, png: png.toString('base64') }));
  }
  /** 先开始采样，再等待 300ms 点击，始终取消超时计时器。
   * @param implementation - 当前原生连接。
   */
  private async sampleNative(implementation: { _send(method: string): Promise<NativeFrame[]> }): Promise<NativeFrame[]> {
    const timeout = new AbortController();
    const { samplingMethod, trigger } = this.options;
    this.observe('native-sampling-start');
    try {
      const pending = Promise.race([
        implementation._send(samplingMethod).then(frames => {
          this.observe('native-sampling-complete');
          return frames;
        }),
        setTimeout(30_000, undefined, { signal: timeout.signal }).then(() => { throw new Error('原生动画采样超时。'); }),
      ]);
      await setTimeout(300);
      await trigger();
      return await pending;
    } finally { timeout.abort(); }
  }
  /** 对同一组完整原始帧运行可选的同步动画检查。 */
  private async inspectFrames(): Promise<void> {
    const { inspectFrames, testInfo } = this.options;
    if (inspectFrames) await inspectFrames(this.originals, testInfo);
  }
  /** 视频帧已裁切，只有遮罩坐标需要平移。
   * @param bounds - 唯一解析的实际区域。
   */
  private makeTimeline(bounds: ScreenshotBounds): Buffer[] {
    if (this.options.samplingMethod !== 'videoFrames') return this.originals.map(frame => this.crop(frame));
    return this.originals.map(frame => maskScreenshot(frame, this.options.masks.map(mask => ({ ...mask,
      x: mask.x - bounds.x, y: mask.y - bounds.y }))));
  }
  /** 保留额外等待及语义就绪的先后顺序。 */
  private async waitForEnd(): Promise<void> {
    const { settleMs, afterReady } = this.options;
    if (settleMs) await setTimeout(settleMs);
    if (afterReady) await afterReady();
  }
  /** 视频只附加每五帧及最后一帧，原生帧全部保留。 */
  private async attachFrames(): Promise<void> {
    for (const [index, frame] of this.timeline.entries()) {
      if (this.shouldAttachFrame(index)) await this.attachImage(`frame-${index}`, frame);
    }
    await this.attachImage('start', this.before);
    await this.attachImage('end', this.after);
  }
  /** 保留原有视频报告采样密度。
   * @param index - 时间线序号。
   */
  private shouldAttachFrame(index: number): boolean {
    if (this.options.samplingMethod !== 'videoFrames') return true;
    return index % 5 === 0 || index === this.timeline.length - 1;
  }
  /** 保存 PNG 附件。
   * @param suffix - 附件后缀。
   * @param body - 原始相位 PNG。
   */
  private async attachImage(suffix: string, body: Buffer): Promise<void> {
    await this.options.testInfo.attach(`${this.options.name}-${suffix}`, { body, contentType: 'image/png' });
  }
  /** 有额外等待或业务就绪回调时，末采样帧不要求已经结束。 */
  private requiresSampleEnd(): boolean { return !this.options.settleMs && !this.options.afterReady; }
  /** 原生截图与视频分别使用既有的像素、颜色分布断言。 */
  private assertEndpoints(): void {
    if (this.options.samplingMethod === 'videoFrames') return this.assertVideoEndpoints();
    const masks = this.options.startCompareMasks;
    expect(samePixels(maskScreenshot(this.timeline[0], masks), maskScreenshot(this.before, masks)),
      '开始采样时动画尚未触发').toBe(true);
    if (this.requiresSampleEnd()) expect(samePixels(this.timeline.at(-1)!, this.after), '采样结束时动画必须完成').toBe(true);
  }
  /** 固定 240×426 录屏放大后的颜色容差保持 10/12。 */
  private assertVideoEndpoints(): void {
    expect(framePaletteDistance(this.timeline[0], this.before), '录屏开始时动画尚未触发').toBeLessThan(10);
    if (this.requiresSampleEnd()) expect(framePaletteDistance(this.timeline.at(-1)!, this.after), '录屏结束时动画必须完成').toBeLessThan(12);
  }
  /** 每个指定区域都必须独立运动。 */
  private assertRequiredRegions(): void {
    const { requiredRegions, masks, name } = this.options;
    if (!requiredRegions.length) return;
    const parts = this.originals.map(frame => motionParts(maskScreenshot(frame, masks), requiredRegions).regions);
    for (const index of requiredRegions.keys()) {
      expect(parts.some(sample => !samePixels(sample[index], parts[0][index])),
        `${name} 第 ${index + 1} 个区域必须独立运动`).toBe(true);
    }
  }
  /** 选择同时区别于首尾的真实中间相位，保留弹簧越界轨迹。 */
  private async compareMotion(): Promise<void> {
    const total = frameColorDistance(this.before, this.after);
    expect(total, '入口点击必须产生足够大的可见变化').toBeGreaterThan(3);
    const candidates = middleCandidates(this.before, this.after, this.timeline, this.options.samplingMethod);
    await this.attachJSON('progress', { total, frames: this.timeline.map(frame => frameColorDistance(this.before, frame) / total) });
    expect(candidates.length, '必须采到起点和终点之间的真实动画帧').toBeGreaterThan(0);
    const middle = candidates.reduce((best, item) => Math.min(item.progress, item.remaining)
      > Math.min(best.progress, best.remaining) ? item : best);
    await this.attachImage('middle', middle.frame);
    await this.attachJSON('middle-progress', { index: middle.index, progress: middle.progress, remaining: middle.remaining });
    if (this.options.testInfo.config.updateSnapshots === 'all') return this.updateSnapshots(middle.frame);
    this.compareSnapshots(candidates, total);
  }
  /** 保留既有更新基准的显式模式。
   * @param middle - 选择的真实中途帧。
   */
  private updateSnapshots(middle: Buffer): void {
    const { name } = this.options;
    expect(this.before).toMatchSnapshot(`${name}-start.png`);
    expect(middle).toMatchSnapshot(`${name}-middle.png`);
    expect(this.after).toMatchSnapshot(`${name}-end.png`);
  }
  /** 读取已审查基准。
   * @param file - 基准文件名。
   */
  private reference(file: string): Buffer { return readFileSync(this.options.testInfo.snapshotPath(file)); }
  /** 首尾逐像素匹配，中途分别使用原生和录屏的原有轨迹断言。
   * @param candidates - 真实中间相位。
   * @param total - 首尾色差。
   */
  private compareSnapshots(candidates: Candidate[], total: number): void {
    const { name, startPhaseAnchors, startCompareMasks, endCompareMasks, videoPhaseAnchors, samplingMethod } = this.options;
    expect([`${name}-start.png`, ...startPhaseAnchors].some(file => samePixels(maskScreenshot(this.before, startCompareMasks),
      maskScreenshot(this.reference(file), startCompareMasks))), '动画起点视觉回归').toBe(true);
    expect(samePixels(maskScreenshot(this.after, endCompareMasks),
      maskScreenshot(this.reference(`${name}-end.png`), endCompareMasks)), '动画终点视觉回归').toBe(true);
    const anchors = [`${name}-middle.png`, ...videoPhaseAnchors].map(file => this.reference(file));
    if (samplingMethod === 'videoFrames') assertReviewedVideoMiddle(this.before, this.after, candidates, anchors);
    else this.compareNativeMiddle(candidates, anchors, total);
  }
  /** 只有远离首尾的原生帧才能匹配已审查相位。
   * @param candidates - 真实中间相位。
   * @param anchors - 已审查相位。
   * @param total - 首尾色差。
   */
  private compareNativeMiddle(candidates: Candidate[], anchors: Buffer[], total: number): void {
    const distances = candidates.flatMap(item => anchors.filter(anchor => this.isNativeMiddle(item.frame, anchor, total))
      .map(anchor => frameColorDistance(item.frame, anchor)));
    expect(Math.min(...distances), '动画中途帧的实际画面须接近已审查轨迹').toBeLessThanOrEqual(36);
  }
  /** 保留各端相对参考三分之一与总色差十分之一的下界。
   * @param frame - 当前相位。
   * @param anchor - 已审查相位。
   * @param total - 首尾色差。
   */
  private isNativeMiddle(frame: Buffer, anchor: Buffer, total: number): boolean {
    return frameColorDistance(this.before, frame) >= Math.min(frameColorDistance(this.before, anchor) / 3, total * 0.1)
      && frameColorDistance(this.after, frame) >= Math.min(frameColorDistance(this.after, anchor) / 3, total * 0.1);
  }
}
