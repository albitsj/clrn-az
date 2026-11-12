import type { TestInfo } from '@playwright/test';
import { motionParts } from './motion-regions';
import type { ScreenshotBounds } from './screenshot';

export type AssetSample = { attempt: number; frames: { capturedAt: number; png: string }[] };

/** 断言结束后才裁切已有原始采样，保留时间戳和所有候选；不再查询设备或重触发效果。
 * @param name - 素材名。
 * @param info - 当前尝试的报告。
 * @param samples - 原驱动已返回的采样。
 * @param region - 原断言使用的效果区域。
 * @param flightRegion - 原断言使用的飞行区域。
 */
export async function preserveAssetSamples(name: string, info: TestInfo, samples: AssetSample[],
  region: ScreenshotBounds, flightRegion?: ScreenshotBounds): Promise<void> {
  if (name !== 'texas-prop-tea' && name !== 'zhajinhua-prop-water' && name !== 'zhajinhua-prop-beer') return;
  try {
    const regions = [region, ...(flightRegion ? [flightRegion] : [])];
    const attempts = samples.map(sample => ({ attempt: sample.attempt,
      frames: sample.frames.map(frame => ({ capturedAt: frame.capturedAt,
        regions: motionParts(Buffer.from(frame.png, 'base64'), regions).regions
          .map(png => png.toString('base64')) })) }));
    await info.attach(`${name}-raw-samples`, {
      body: JSON.stringify({ regions, attempts }), contentType: 'application/json',
    });
  } catch { /* 诊断失败不能覆盖原始断言异常。 */ }
}
