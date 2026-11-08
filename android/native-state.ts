import { expect } from '@playwright/test';
import type { AndroidDevice, AndroidSelector } from 'playwright';

/**
 * 查询控件是否可见；排除屏外历史弹层，只把查找空指针识别为不存在。
 * @param device - 专用模拟器连接。
 * @param selector - 原生控件条件。
 */
export async function exists(device: AndroidDevice, selector: AndroidSelector): Promise<boolean> {
  return queryVisible(device, selector, 0);
}

/**
 * 等待控件消失；当前 Playwright Android 驱动的 wait 实现未处理 gone 状态。
 * @param device - 专用模拟器连接。
 * @param selector - 应从控件树中移除的目标。
 */
export async function waitAbsent(device: AndroidDevice, selector: AndroidSelector): Promise<void> {
  await expect.poll(() => exists(device, selector), { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(false);
}

/** 查询当前树；过期对象只重查原有的四次。
 * @param device - 原生设备。
 * @param selector - 控件条件。
 * @param attempt - 已重查次数。
 */
async function queryVisible(device: AndroidDevice, selector: AndroidSelector, attempt: number): Promise<boolean> {
  try {
    const { bounds } = await device.info(selector);
    return visibleBounds(bounds);
  } catch (error) { return recoverQuery(error, device, selector, attempt); }
}

/** 区分空节点、过期节点与真实连接故障。
 * @param error - 查询错误。
 * @param device - 原生设备。
 * @param selector - 控件条件。
 * @param attempt - 已重查次数。
 */
async function recoverQuery(error: unknown, device: AndroidDevice, selector: AndroidSelector, attempt: number): Promise<boolean> {
  if (/NullPointerException|UiObjectNotFoundException/.test(String(error))) return false;
  if (!retryStale(error, attempt)) throw error;
  return queryVisible(device, selector, attempt + 1);
}

/** 判断是否仍可重查过期节点。
 * @param error - 查询错误。
 * @param attempt - 已重查次数。
 */
function retryStale(error: unknown, attempt: number): boolean {
  return /StaleObjectException/.test(String(error)) && attempt < 4;
}

/** 正尺寸控件须与固定屏幕相交。
 * @param bounds - 控件边界。
 */
function visibleBounds(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return positiveArea(bounds) && intersectsAxis(bounds.x, bounds.width, 720) && intersectsAxis(bounds.y, bounds.height, 1280);
}

/** 无面积的节点不是可见控件。
 * @param bounds - 控件尺寸。
 */
function positiveArea(bounds: { width: number; height: number }): boolean { return bounds.width > 0 && bounds.height > 0; }

/** 一个方向须与屏幕半开区间相交。
 * @param start - 控件起点。
 * @param size - 控件长度。
 * @param screenSize - 屏幕长度。
 */
function intersectsAxis(start: number, size: number, screenSize: number): boolean { return start < screenSize && start + size > 0; }
