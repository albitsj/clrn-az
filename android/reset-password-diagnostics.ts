import type { AndroidDevice } from 'playwright';
import type { TestInfo } from '@playwright/test';
import { adb, compareScreenshot } from './device';
import type { ScreenshotMask } from './screenshot';
import { collectPasswordNativeMetrics } from './password-native-metrics';

type PasswordSample = { elapsedMs: number; body: Buffer };

/** 保留密码页既有采样的时间线，区分持续折行与延迟重排；不改变比较条件。
 * @param device - 当前原生设备。
 * @param name - 截图名称。
 * @param info - 当前用例报告，包含重试编号。
 * @param masks - 原场景已有遮罩。
 */
export async function compareResetPassword(device: AndroidDevice, name: string, info: TestInfo, masks: ScreenshotMask[]): Promise<void> {
  const started = Date.now();
  const frames: PasswordSample[] = [];
  let last: PasswordSample | undefined;
  /** 复用比较器实际采样，不增加截图或等待。 */
  const capture = async (): Promise<Buffer> => {
    const body = await device.screenshot();
    last = { elapsedMs: Date.now() - started, body };
    if (frames.length < 12) frames.push(last);
    return body;
  };
  try {
    await compareScreenshot(device, name, info, masks, undefined, capture);
  } finally {
    if (last && frames.at(-1) !== last) frames.push(last);
    // 诊断是旁路证据，附件、节点和 ADB 故障都不得覆盖比较结果或原始异常。
    await preservePasswordEvidence(device, name, info, frames).catch(() => undefined);
    await collectPasswordNativeMetrics(device, info).catch(async error => {
      await info.attach('password-native-metrics-error', { body: String(error), contentType: 'text/plain' }).catch(() => undefined);
    });
  }
}

/** 保存既有截图与脱敏布局，调用方统一隔离诊断故障。
 * @param device - 本次比较的同一设备。
 * @param name - 附件前缀。
 * @param info - 当前尝试的报告。
 * @param frames - 比较器已经采集的有限原图。
 */
async function preservePasswordEvidence(device: AndroidDevice, name: string, info: TestInfo,
  frames: PasswordSample[]): Promise<void> {
  for (const [index, frame] of frames.entries()) {
    await info.attach(`${name}-sample-${index}-${frame.elapsedMs}ms`, { body: frame.body, contentType: 'image/png' });
  }
  const inputs = [];
  for (const res of ['old-password-input-title', 'old-password-input', 'new-password-title', 'new-password-input']) {
    const node = await device.info({ res }).catch(() => undefined);
    // 不保存 text 或完整节点，密码字段和账号信息不得进入诊断。
    inputs.push({ res, bounds: node?.bounds, focused: node?.focused });
  }
  await info.attach(`${name}-layout`, { contentType: 'application/json', body: JSON.stringify({
    retry: info.retry, inputs,
    fontScale: adb('shell', 'settings', 'get', 'system', 'font_scale').trim(),
    density: adb('shell', 'wm', 'density').trim(),
    size: adb('shell', 'wm', 'size').trim(),
  }) });
}
