import type { AndroidDevice } from 'playwright';
import type { TestInfo } from '@playwright/test';
import { adb, compareScreenshot } from './device';
import type { ScreenshotMask } from './screenshot';

/** 保留密码页既有采样的时间线，区分持续折行与延迟重排；不改变比较条件。
 * @param device - 当前原生设备。
 * @param name - 截图名称。
 * @param info - 当前用例报告，包含重试编号。
 * @param masks - 原场景已有遮罩。
 */
export async function compareResetPassword(device: AndroidDevice, name: string, info: TestInfo, masks: ScreenshotMask[]): Promise<void> {
  const started = Date.now();
  const frames: { elapsedMs: number; body: Buffer }[] = [];
  let last: { elapsedMs: number; body: Buffer } | undefined;
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
}
