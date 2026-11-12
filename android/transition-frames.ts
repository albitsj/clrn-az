import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { recordNativeVideoFrames, type AnimationRegion } from './video-frames';
import { recordSurfaceRegion } from './surface-frame-images';

type TransitionCapture = { device: AndroidDevice; name: string; region: AnimationRegion;
  trigger: () => unknown; info: TestInfo };

/** 仅老虎机退场使用连续原始帧，比较仍走原空间门禁。
 * @param context - 本次真实转场及完整比较区域。
 * @param recorder - 单元测试可替换外部设备录制边界。
 */
export async function recordTransitionFrames(context: TransitionCapture, recorder?: typeof recordNativeVideoFrames):
Promise<{ capturedAt: number; png: string }[]> {
  if ((!recorder || recorder === recordNativeVideoFrames) && context.name === 'slot-popup-exit') {
    const bounds = typeof context.region === 'function' ? await context.region() : context.region;
    return recordSurfaceRegion({ ...context, bounds });
  }
  const record = recorder ?? recordNativeVideoFrames;
  return (await record(context.name, context.region, context.trigger, context.info))
    .map((png, index) => ({ capturedAt: index * 33, png: png.toString('base64') }));
}
