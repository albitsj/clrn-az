import type { ScreenshotBounds } from './screenshot';

/** 检查半开区间中的坐标。
 * @param value - 待测坐标。
 * @param start - 区间起点。
 * @param size - 区间长度。
 */
function inAxis(value: number, start: number, size: number): boolean {
  return value >= start && value < start + size;
}

/** 检查像素是否落在矩形内。
 * @param bounds - 矩形边界。
 * @param x - 像素横坐标。
 * @param y - 像素纵坐标。
 */
export function pointInBounds(bounds: ScreenshotBounds, x: number, y: number): boolean {
  return inAxis(x, bounds.x, bounds.width) && inAxis(y, bounds.y, bounds.height);
}

/** 检查闭区间中的坐标，保留遮罩点击位置的边界规则。
 * @param value - 待测坐标。
 * @param start - 区间起点。
 * @param size - 区间长度。
 */
function inClosedAxis(value: number, start: number, size: number): boolean {
  return value >= start && value <= start + size;
}

/** 检查点击位置是否落在面板边缘或内部。
 * @param bounds - 面板边界。
 * @param point - 待点击位置。
 */
export function pointOnPanel(bounds: ScreenshotBounds, point: { x: number; y: number }): boolean {
  return inClosedAxis(point.x, bounds.x, bounds.width) && inClosedAxis(point.y, bounds.y, bounds.height);
}

/** 检查两个方向区间是否有正面积交集。
 * @param start - 第一个起点。
 * @param size - 第一个长度。
 * @param otherStart - 第二个起点。
 * @param otherSize - 第二个长度。
 */
function overlapsAxis(start: number, size: number, otherStart: number, otherSize: number): boolean {
  return start < otherStart + otherSize && start + size > otherStart;
}

/** 检查两个矩形是否相交。
 * @param first - 第一个矩形。
 * @param second - 第二个矩形。
 */
export function overlappingBounds(first: ScreenshotBounds, second: ScreenshotBounds): boolean {
  return overlapsAxis(first.x, first.width, second.x, second.width)
    && overlapsAxis(first.y, first.height, second.y, second.height);
}
