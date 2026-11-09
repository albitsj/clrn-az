import { setTimeout } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';
import { motionParts } from './motion-regions';
import type { ScreenshotBounds } from './screenshot';

type NativeFrame = { capturedAt: number; png: string };
type RegionFrame = { capturedAt: number; regions: string[] };
type AssetConnection = { _send(method: string, params?: object): Promise<unknown> };
type AssetCapture = { name: string; info: TestInfo; region: ScreenshotBounds;
  trigger: () => Promise<unknown>; flightRegion?: ScreenshotBounds };

/** 无损采集同一次消息，只有已有反例的茶道具使用更密集的区域采样。
 * @param implementation - 原生设备边界。
 * @param context - 真实消息和原有比较区域。
 */
export async function collectAssetFrames(implementation: AssetConnection, context: AssetCapture):
Promise<{ receiver: Buffer[]; flight: Buffer[] }> {
  const regions = [context.region, ...(context.flightRegion ? [context.flightRegion] : [])];
  const dense = context.name === 'texas-prop-tea' && Boolean(context.flightRegion);
  const pending = implementation._send(dense ? 'assetFrames' : 'motionFrames', dense ? { regions } : undefined);
  // 不改变采集开始后 300 毫秒再发送消息的顺序，每次采集只触发一次。
  await setTimeout(300);
  await context.trigger();
  const controller = new AbortController();
  const timeout = setTimeout(dense ? 60_000 : 30_000, undefined, { signal: controller.signal }).then(() => {
    throw new Error(`${context.name} 原生素材采集超时`);
  });
  let raw: unknown;
  try { raw = await Promise.race([pending, timeout]); } finally { controller.abort(); }
  if (dense) {
    const frames = raw as RegionFrame[];
    await attachAssetFrames(context, frames);
    return { receiver: frames.map(frame => Buffer.from(frame.regions[0], 'base64')),
      flight: frames.map(frame => Buffer.from(frame.regions[1], 'base64')) };
  }
  const frames = (raw as NativeFrame[]).map(frame => motionParts(Buffer.from(frame.png, 'base64'), regions).regions);
  return { receiver: frames.map(frame => frame[0]), flight: context.flightRegion ? frames.map(frame => frame[1]) : [] };
}

/** 失败前保留原生采样时间和所有真实飞行帧，附件异常不能替代原比较结果。
 * @param context - 当前用例及实际区域。
 * @param frames - 原生设备返回的无损区域帧。
 */
async function attachAssetFrames(context: AssetCapture, frames: RegionFrame[]): Promise<void> {
  try {
    await context.info.attach(`${context.name}-native-sampling`, {
      body: JSON.stringify({ method: 'assetFrames', regions: [context.region, context.flightRegion],
        capturedAt: frames.map(frame => frame.capturedAt) }), contentType: 'application/json' });
    for (const [index, frame] of frames.entries()) {
      await context.info.attach(`${context.name}-native-flight-${String(index).padStart(4, '0')}.png`,
        { body: Buffer.from(frame.regions[1], 'base64'), contentType: 'image/png' });
    }
  } catch { /* 采样诊断失败不能掩盖真实视觉失败。 */ }
}
