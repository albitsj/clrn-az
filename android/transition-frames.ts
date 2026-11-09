import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { attachRegionFrames, sampleNativeFrames, type NativeRegionFrame, type SamplingConnection } from './native-sampling';
import { recordNativeVideoFrames, type AnimationRegion } from './video-frames';
import { maskScreenshot, type ScreenshotBounds, type ScreenshotMask } from './screenshot';

type TransitionCapture = { device: AndroidDevice; name: string; region: AnimationRegion;
  trigger: () => unknown; info: TestInfo };

/** 仅对有两次缺相位反例的老虎机退场使用原生区域采样，比较仍走原空间门禁。
 * @param context - 本次真实转场及完整比较区域。
 * @param recorder - 单元测试可替换外部设备录制边界。
 */
export async function recordTransitionFrames(context: TransitionCapture, recorder?: typeof recordNativeVideoFrames):
Promise<{ capturedAt: number; png: string }[]> {
  if ((recorder && recorder !== recordNativeVideoFrames) || context.name !== 'slot-popup-exit') {
    const record = recorder ?? recordNativeVideoFrames;
    return (await record(context.name, context.region, context.trigger, context.info))
      .map((png, index) => ({ capturedAt: index * 33, png: png.toString('base64') }));
  }
  const bounds = typeof context.region === 'function' ? await context.region() : context.region;
  const connection = (context.device as unknown as { _connection: {
    toImpl(device: AndroidDevice): SamplingConnection } })._connection.toImpl(context.device);
  const frames = await sampleNativeFrames<NativeRegionFrame>(connection, { name: context.name, method: 'panelFrames',
    params: { regions: [bounds] }, timeoutMs: 60_000, trigger: context.trigger });
  return nativeRegionTimeline(frames, { name: context.name, info: context.info, bounds });
}

/** 在原有原生断言路径内，为邀请抽屉固定选择无损区域协议。
 * @param implementation - 原生设备连接。
 * @param context - 动效名称、原协议及原始比较范围。
 */
export async function requestTransitionFrames(implementation: SamplingConnection, context: {
  name: string; method: string; region: AnimationRegion; info: TestInfo }):
Promise<{ capturedAt: number; png: string }[]> {
  if (!croppedMotionFrames(context.name, context.method)) {
    return await implementation._send(context.method) as { capturedAt: number; png: string }[];
  }
  const bounds = typeof context.region === 'function' ? await context.region() : context.region;
  const frames = await implementation._send('panelFrames', { regions: [bounds] }) as NativeRegionFrame[];
  return nativeRegionTimeline(frames, { name: context.name, info: context.info, bounds });
}

/** 区域命令已经裁切真实截图；普通原生帧仍按原有完整屏幕方式裁切。
 * @param frame - 当前设备帧，不合成不同时间的像素。
 * @param context - 明确选择的协议与原遮罩坐标。
 */
export function cropTransitionFrame(frame: Buffer, context: { name: string; method: string;
  crop: (bytes: Buffer) => Buffer; masks: ScreenshotMask[]; bounds: ScreenshotBounds }): Buffer {
  if (!croppedMotionFrames(context.name, context.method)) return context.crop(frame);
  return maskScreenshot(frame, context.masks.map(mask => ({ ...mask,
    x: mask.x - context.bounds.x, y: mask.y - context.bounds.y })));
}

/** 同一邀请抽屉的入场与退场都保留原非录屏比较门禁。
 * @param name - 明确登记的动画名称。
 * @param method - 调用方既有采集协议。
 */
function croppedMotionFrames(name: string, method: string): boolean {
  return ['invite-friends-enter', 'invite-friends-exit'].includes(name) && method === 'motionFrames';
}

/** 保留实际时间戳及全部变化帧，再交回调用方原有断言。
 * @param frames - 设备返回的真实区域 PNG。
 * @param context - 当前报告和原始区域。
 */
async function nativeRegionTimeline(frames: NativeRegionFrame[], context: {
  name: string; info: TestInfo; bounds: ScreenshotBounds }): Promise<{ capturedAt: number; png: string }[]> {
  await attachRegionFrames({ name: context.name, method: 'panelFrames', info: context.info,
    regions: [context.bounds], attachment: { index: 0, label: 'frame' } }, frames);
  return frames.map(frame => ({ capturedAt: frame.capturedAt, png: frame.regions[0] }));
}
