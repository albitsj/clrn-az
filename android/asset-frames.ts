import type { TestInfo } from '@playwright/test';
import { motionParts } from './motion-regions';
import type { ScreenshotBounds } from './screenshot';
import { attachRegionFrames, sampleNativeFrames, type NativeRegionFrame } from './native-sampling';

type NativeFrame = { capturedAt: number; png: string };
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
  const raw = await sampleNativeFrames<NativeRegionFrame | NativeFrame>(implementation, {
    name: context.name, method: dense ? 'assetFrames' : 'motionFrames', params: dense ? { regions } : undefined,
    timeoutMs: dense ? 60_000 : 30_000, trigger: context.trigger });
  if (dense) {
    const frames = raw as NativeRegionFrame[];
    await attachRegionFrames({ name: context.name, method: 'assetFrames', info: context.info, regions,
      attachment: { index: 1, label: 'flight' } }, frames);
    return { receiver: frames.map(frame => Buffer.from(frame.regions[0], 'base64')),
      flight: frames.map(frame => Buffer.from(frame.regions[1], 'base64')) };
  }
  const frames = (raw as NativeFrame[]).map(frame => motionParts(Buffer.from(frame.png, 'base64'), regions).regions);
  return { receiver: frames.map(frame => frame[0]), flight: context.flightRegion ? frames.map(frame => frame[1]) : [] };
}
