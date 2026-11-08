import type { AndroidDevice, AndroidSelector } from 'playwright';
import { expect } from '@playwright/test';
import { dismissKeyboard } from './keyboard';
import { waitAbsent } from './native-state';
import { adb } from './device-command';

/**
 * 按原生控件定位；目标在列表下方时通过真实滑动寻找。
 * @param device - 专用模拟器连接。
 * @param selector - 目标控件。
 * @param fullyVisible - 点击列表行时要求整个控件位于系统手势条上方。
 */
export async function reveal(device: AndroidDevice, selector: AndroidSelector, fullyVisible = false): Promise<void> {
  await revealAttempts(device, selector, fullyVisible);
}

/** 保留九次查询及滑动预算。
 * @param device - 原生设备。
 * @param selector - 目标控件。
 * @param fullyVisible - 是否要求整行可见。
 */
async function revealAttempts(device: AndroidDevice, selector: AndroidSelector, fullyVisible: boolean): Promise<void> {
  for (let attempt = 0; attempt < 9; attempt++) {
    if (await revealAttempt(device, selector, fullyVisible, attempt)) return;
  }
}

/** 查询与恢复分开，最后一次失败仍抛出原始错误。
 * @param device - 原生设备。
 * @param selector - 目标控件。
 * @param fullyVisible - 是否要求整行可见。
 * @param attempt - 当前尝试次数。
 */
async function revealAttempt(device: AndroidDevice, selector: AndroidSelector, fullyVisible: boolean, attempt: number): Promise<boolean> {
  try {
    await device.wait(selector, { timeout: attempt === 0 ? 7000 : 3000 });
    assertRevealed((await device.info(selector)).bounds, fullyVisible);
    return true;
  } catch (error) {
    assertRetry(attempt, error);
    return recoverReveal(device, selector, fullyVisible);
  }
}

/** 保留所有可见性断言，包括整行位于手势条上方的额外约束。
 * @param bounds - 实际控件边界。
 * @param fullyVisible - 是否要求整行可见。
 */
function assertRevealed(bounds: { width: number; height: number; y: number }, fullyVisible: boolean): void {
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.y).toBeLessThan(1232);
  if (fullyVisible) expect(bounds.y + bounds.height).toBeLessThanOrEqual(1250);
  expect(bounds.y + bounds.height).toBeGreaterThan(0);
}

/** 原有预算用尽后保留原始错误。
 * @param attempt - 当前尝试次数。
 * @param error - 当前查询错误。
 */
export function assertRetry(attempt: number, error: unknown): void {
  if (attempt === 8) throw error;
}

/** 滑动前收起异步出现的输入法，优先通过真实按钮关闭新手引导。
 * @param device - 原生设备。
 * @param selector - 目标控件。
 * @param fullyVisible - 是否查询纵向容器。
 */
async function recoverReveal(device: AndroidDevice, selector: AndroidSelector, fullyVisible: boolean): Promise<boolean> {
  await dismissKeyboard(device);
  if (await dismissRevealTutorial(device)) return false;
  const scrollable = await device.info(scrollSelector(fullyVisible)).catch(() => undefined);
  if (!scrollable) { await device.wait(selector, { timeout: 30_000 }); return true; }
  const { bounds } = scrollable;
  // 从右侧内缘滑动，避开建房滑杆的触摸范围。
  const horizontal = Math.round(bounds.x + bounds.width - 2);
  adb('shell', 'input', 'swipe', String(horizontal), String(Math.round(bounds.y + bounds.height * 0.85)),
    String(horizontal), String(Math.round(bounds.y + bounds.height * 0.2)), '600');
  return false;
}

/** 战绩首个容器是横向标签栏，整行可见时限定纵向列表。
 * @param fullyVisible - 是否要求整行可见。
 */
function scrollSelector(fullyVisible: boolean): AndroidSelector {
  return fullyVisible ? { scrollable: true, clazz: 'android.widget.ScrollView' } : { scrollable: true };
}

/** reveal 时优先完成引导，未到完成步骤则点击下一步。
 * @param device - 原生设备。
 */
async function dismissRevealTutorial(device: AndroidDevice): Promise<boolean> {
  const tutorial = await device.info({ res: 'stepDescription' }).catch(() => undefined);
  if (!tutorial) return false;
  await advanceTutorial(device);
  return true;
}

/** 在原来的步骤完成时等待引导消失。
 * @param device - 原生设备。
 */
async function advanceTutorial(device: AndroidDevice): Promise<void> {
  const finish = await device.info({ res: 'tooltip-finish-button' }).catch(() => undefined);
  await device.tap({ res: finish ? 'tooltip-finish-button' : 'tooltip-next-button' });
  if (finish) await waitAbsent(device, { res: 'stepDescription' });
}
