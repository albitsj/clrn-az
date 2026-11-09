import { setTimeout } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';
import type { ScreenshotBounds } from './screenshot';

export type SamplingConnection = { _send(method: string, params?: object): Promise<unknown> };
export type NativeRegionFrame = { capturedAt: number; regions: string[]; sampledAt?: number[] };
type SamplingRequest = { name: string; method: string; params?: object; timeoutMs: number; trigger: () => unknown };
type RegionReport = { name: string; method: string; info: TestInfo; regions: ScreenshotBounds[];
  attachment: { index: number; label: string } };

/** 原生采集先启动，300 毫秒后通过独立入口触发；异常与超时均取消尚未发生的触发。
 * @param implementation - 实际设备连接。
 * @param context - 采集命令、真实入口及响应期限。
 */
export async function sampleNativeFrames<T>(implementation: SamplingConnection, context: SamplingRequest): Promise<T[]> {
  const controller = new AbortController();
  const pending = Promise.all([implementation._send(context.method, context.params),
    setTimeout(300, undefined, { signal: controller.signal }).then(() => context.trigger())]);
  const timeout = setTimeout(context.timeoutMs, undefined, { signal: controller.signal }).then(() => {
    throw new Error(`${context.name} 原生采集超时`);
  });
  try { return (await Promise.race([pending, timeout]))[0] as T[]; }
  finally { controller.abort(); }
}

/** 保留设备时间戳与全部真实区域帧，诊断写入失败不代替视觉断言。
 * @param context - 当前报告及原有比较区域。
 * @param frames - 设备实际返回的无损帧。
 */
export async function attachRegionFrames(context: RegionReport, frames: NativeRegionFrame[]): Promise<void> {
  try {
    await context.info.attach(`${context.name}-native-sampling`, {
      body: JSON.stringify({ method: context.method, regions: context.regions,
        capturedAt: frames.map(frame => frame.capturedAt), sampledAt: frames[0]?.sampledAt }), contentType: 'application/json' });
    for (const [index, frame] of frames.entries()) {
      await context.info.attach(`${context.name}-native-${context.attachment.label}-${String(index).padStart(4, '0')}.png`,
        { body: Buffer.from(frame.regions[context.attachment.index], 'base64'), contentType: 'image/png' });
    }
  } catch { /* 原始采样和比较结果必须继续传播。 */ }
}
