import { PNG } from 'pngjs';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

/**
 * 将真实检测到的细光标平移到键盘收起后的输入框位置。
 * @param caret - 采样时的光标和输入框。
 * @param bounds - 键盘收起后的输入框边界。
 */
export function translateCaret(caret: { mask: ScreenshotMask; input: { bounds: ScreenshotBounds } },
  bounds: ScreenshotBounds): ScreenshotMask {
  return { ...caret.mask, x: caret.mask.x + bounds.x - caret.input.bounds.x,
    y: caret.mask.y + bounds.y - caret.input.bounds.y };
}

/**
 * 仅识别聚焦输入框内细窄的闪烁光标，拒绝遮住文本变化或整行区域。
 * @param before - 前一帧截图。
 * @param after - 后一帧截图。
 * @param bounds - 已确认文字未变化的聚焦输入框边界。
 */
export function caretMask(before: Buffer, after: Buffer,
  bounds: { x: number; y: number; width: number; height: number }): ScreenshotMask | undefined {
  const first = PNG.sync.read(before);
  const second = PNG.sync.read(after);
  if (![first.width === second.width, first.height === second.height].every(Boolean)) return;
  const { left, right, top, bottom } = changedBounds(first, second, bounds);
  const width = right - left + 1, height = bottom - top + 1;
  if (![width >= 1, width <= 6, height >= 12, height <= 80].every(Boolean)) return;
  return { x: left, y: top, width, height, reason: '输入光标闪烁；输入文字、边框和其余像素仍比较' };
}

/** 查找输入框中改变像素的最小边界。
 * @param first - 前一帧。
 * @param second - 后一帧。
 * @param bounds - 输入框边界。
 */
function changedBounds(first: PNG, second: PNG, bounds: ScreenshotBounds) {
  const changed = { left: first.width, right: -1, top: first.height, bottom: -1 };
  for (let y = Math.max(0, bounds.y); y < Math.min(first.height, bounds.y + bounds.height); y++) {
    scanChangedRow(first, second, bounds, y, changed);
  }
  return changed;
}
/** 累计一行发生变化的像素，保留原始 RGBA 比较。
 * @param first - 前一帧。
 * @param second - 后一帧。
 * @param bounds - 输入框边界。
 * @param y - 当前行。
 * @param changed - 累计改变边界。
 */
function scanChangedRow(first: PNG, second: PNG, bounds: ScreenshotBounds, y: number,
  changed: { left: number; right: number; top: number; bottom: number }): void {
  for (let x = Math.max(0, bounds.x); x < Math.min(first.width, bounds.x + bounds.width); x++) {
    const offset = (y * first.width + x) * 4;
    if (first.data.subarray(offset, offset + 4).equals(second.data.subarray(offset, offset + 4))) continue;
    changed.left = Math.min(changed.left, x); changed.right = Math.max(changed.right, x);
    changed.top = Math.min(changed.top, y); changed.bottom = Math.max(changed.bottom, y);
  }
}
