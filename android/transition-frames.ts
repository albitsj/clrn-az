import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { attachRegionFrames, sampleNativeFrames, type NativeRegionFrame, type SamplingConnection } from './native-sampling';
import { recordNativeVideoFrames, type AnimationRegion } from './video-frames';

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
  await attachRegionFrames({ name: context.name, method: 'panelFrames', info: context.info,
    regions: [bounds], attachment: { index: 0, label: 'frame' } }, frames);
  return frames.map(frame => ({ capturedAt: frame.capturedAt, png: frame.regions[0] }));
}
