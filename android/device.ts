import type { AndroidDevice } from 'playwright';
import { expect, type TestInfo } from '@playwright/test';
import { maskScreenshot, type ScreenshotMask } from './screenshot';
import { samePixels } from './motion-regions';

export { adb, artifacts } from './device-command';
export { launchApplication } from './device-launch';
export { waitForHall, waitForStagingNotice } from './device-startup';
// @ts-expect-error 元数据验证模块也供纯 Node 下载入口使用。
export { applicationId } from './release.mjs';

/**
 * 连续截图稳定后进行像素比较，拒绝把加载态或动画帧作为基准。
 * @param device - 专用模拟器连接。
 * @param name - 截图场景名称。
 * @param testInfo - Playwright 当前测试报告。
 * @param masks - 明确排除的动态区域，报告保留原图和区域原因。
 * @param transientState - 短时提示的可见性断言；普通页面仍须稳定两秒。
 * @param takeScreenshot - 短时提示使用同一设备上的快速原生截图接口。
 */
export async function compareScreenshot(device: AndroidDevice, name: string, testInfo: TestInfo, masks: ScreenshotMask[] = [],
  transientState?: () => Promise<void>, takeScreenshot: () => Promise<Buffer> = () => device.screenshot()): Promise<void> {
  await attachMasks(testInfo, name, masks);
  await checkTransient(transientState);
  const initial = await takeScreenshot();
  await checkTransient(transientState);
  let previous = maskScreenshot(initial, masks);
  let stabilityReference = previous;
  let stableSince = Date.now();
  let stable: Buffer | undefined;
  let original: Buffer | undefined;
  let comparisonBefore = previous;
  let comparisonAfter = previous;
  const timing = screenshotTiming(transientState);
  await expect(async () => {
    await checkTransient(transientState);
    original = await takeScreenshot();
    await checkTransient(transientState);
    const current = maskScreenshot(original, masks);
    comparisonBefore = previous;
    comparisonAfter = current;
    // 稳定检测与最终基准使用同一比较器；不把 GPU 的单色阶抖动当作持续动画。
    // 固定本段稳定期的参考帧，避免连续缓慢变化通过逐帧小差异累积漂移。
    const equal = samePixels(current, stabilityReference);
    previous = current;
    if (!equal) { stableSince = Date.now(); stabilityReference = current; }
    expect(equal, '页面像素必须保持稳定').toBe(true);
    expect(Date.now() - stableSince, '普通页面等待滚动条淡出；短时提示须在可见期间连续稳定')
      .toBeGreaterThanOrEqual(timing.stableMs);
    stable = current;
  }).toPass({ timeout: 30_000, intervals: [timing.intervalMs] }).catch(async error => {
    // 保留最后两帧及既有遮罩说明，便于定位真实动态区域，不自动扩大容差。
    await testInfo.attach(`${name}-unstable-before`, { body: comparisonBefore, contentType: 'image/png' });
    await testInfo.attach(`${name}-unstable-after`, { body: comparisonAfter, contentType: 'image/png' });
    throw error;
  });
  await attachOriginal(testInfo, name, masks, original!);
  await testInfo.attach(name, { body: stable!, contentType: 'image/png' });
  expect.soft(stable!).toMatchSnapshot(`${name}.png`);
}

/** 仅在短时提示存在时执行可见性断言。
 * @param check - 短时状态断言。
 */
async function checkTransient(check: (() => Promise<void>) | undefined): Promise<void> { await check?.(); }

/** 保留普通页面与短时提示的稳定期及采样间隔。
 * @param transient - 是否有短时可见性断言。
 */
function screenshotTiming(transient: unknown): { stableMs: number; intervalMs: number } {
  return { stableMs: transient ? 250 : 2000, intervalMs: transient ? 100 : 500 };
}

/** 保留非空遮罩说明。
 * @param info - 测试报告。
 * @param name - 场景名称。
 * @param masks - 动态区域。
 */
async function attachMasks(info: TestInfo, name: string, masks: ScreenshotMask[]): Promise<void> {
  if (masks.length) await info.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
}

/** 有遮罩时同时保留未经修改的截图。
 * @param info - 测试报告。
 * @param name - 场景名称。
 * @param masks - 动态区域。
 * @param body - 原始像素。
 */
async function attachOriginal(info: TestInfo, name: string, masks: ScreenshotMask[], body: Buffer): Promise<void> {
  if (masks.length) await info.attach(`${name}-original`, { body, contentType: 'image/png' });
}
