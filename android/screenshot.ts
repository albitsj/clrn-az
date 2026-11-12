import { PNG } from 'pngjs';
import type { AndroidDevice } from 'playwright';
import type { VisualScenario } from '../visual/scenarioTypes';
import { nativeSelector } from './scenarios';
import { setTimeout } from 'node:timers/promises';
import { caretMask } from './caret-mask';

export type ScreenshotMask = { x: number; y: number; width: number; height: number; reason: string };
export type ScreenshotBounds = Omit<ScreenshotMask, 'reason'>;
/** 从两帧真实截图识别聚焦输入框的光标，保留原输入边界以适配键盘收起后的窗口位移。
 * @param device - 专用模拟器连接。
 * @param selector - 可选的精确输入框选择器。
 * @param observed - 保留最后一组采样原图的诊断边界。
 */
export async function focusedCaretMask(device: AndroidDevice, selector: Parameters<AndroidDevice['info']>[0] = { clazz: 'android.widget.EditText', focused: true }, observed?: (sample: CaretSample) => void) {
  const input = await device.info(selector).catch(() => undefined);
  if (input) return sampleCaret(device, selector, input, observed);
}

/** 在输入框存在时按原交错间隔查找真实闪烁光标。
 * @param device - 专用模拟器。
 * @param selector - 已找到的输入框。
 * @param input - 首次输入框信息。
 * @param observed - 诊断回调。
 */
async function sampleCaret(device: AndroidDevice, selector: Parameters<AndroidDevice['info']>[0],
  input: CaretSample['input'], observed: ((sample: CaretSample) => void) | undefined) {
  let before = await device.screenshot();
  for (const delay of [137, 263, 419, 181, 347, 223, 389, 157, 293, 431, 199, 317]) {
    await setTimeout(delay);
    const after = await device.screenshot();
    const current = await device.info(selector);
    const mask = stableCaret(before, after, input, current);
    observeCaret(observed, { before, after, input: current });
    if (mask) return { mask, input };
    before = after;
    input = current;
  }
}
/** 仅在文字和边界未变化时检测光标。
 * @param before - 前帧。
 * @param after - 后帧。
 * @param input - 前次控件。
 * @param current - 当前控件。
 */
function stableCaret(before: Buffer, after: Buffer, input: CaretSample['input'], current: CaretSample['input']) {
  if (current.text !== input.text) return;
  if (JSON.stringify(current.bounds) !== JSON.stringify(input.bounds)) return;
  return caretMask(before, after, input.bounds);
}
/** 传递最后一组原图，保持可选回调语义。
 * @param observed - 诊断回调。
 * @param sample - 实际采样。
 */
function observeCaret(observed: ((sample: CaretSample) => void) | undefined, sample: CaretSample): void {
  observed?.(sample);
}

/**
 * 仅排除版本、日期和自动轮播帧，原始截图仍附在报告中供检查。
 * @param device - 专用模拟器连接。
 * @param scenario - 共用的页面场景。
 * @param backgroundBanner - 打开原生弹窗前保存的背景横幅边界。
 */
export async function screenshotMasks(device: AndroidDevice, scenario: VisualScenario, backgroundBanner?: ScreenshotBounds): Promise<ScreenshotMask[]> {
  const masks: ScreenshotMask[] = [];
  const caret = await focusedCaretMask(device);
  if (caret) masks.push(caret.mask);
  masks.push(...await fixedTextMasks(device, scenario));
  masks.push(...await bannerMasks(device, scenario, backgroundBanner));
  return masks;
}

/**
 * 给明确列出的动态区域加可见遮罩；拒绝过大的遮罩掩盖整页布局。
 * @param bytes - 原始 PNG 截图。
 * @param masks - 已从真实控件计算出的动态区域。
 */
export function maskScreenshot(bytes: Buffer, masks: ScreenshotMask[]): Buffer {
  if (!masks.length) return bytes;
  const picture = PNG.sync.read(bytes);
  let area = 0;
  for (const mask of masks) {
    const left = Math.max(0, Math.floor(mask.x));
    const top = Math.max(0, Math.floor(mask.y));
    const right = Math.min(picture.width, Math.ceil(mask.x + mask.width));
    const bottom = Math.min(picture.height, Math.ceil(mask.y + mask.height));
    area += Math.max(0, right - left) * Math.max(0, bottom - top);
    fillMask(picture, left, top, right, bottom);
  }
  validateMaskArea(area, picture);
  return PNG.sync.write(picture);
}

/** 填充已裁切到画布内的遮罩。
 * @param picture - 原图。
 * @param left - 左界。
 * @param top - 上界。
 * @param right - 右界。
 * @param bottom - 下界。
 */
function fillMask(picture: PNG, left: number, top: number, right: number, bottom: number): void {
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const offset = (y * picture.width + x) * 4;
    picture.data[offset] = 230;
    picture.data[offset + 1] = 210;
    picture.data[offset + 2] = 235;
    picture.data[offset + 3] = 255;
  }
}

export type CaretSample = { before: Buffer; after: Buffer; input: Awaited<ReturnType<AndroidDevice['info']>> };

/** 收集明确列出的版本和日期控件。
 * @param device - 专用模拟器。
 * @param scenario - 页面场景。
 */
async function fixedTextMasks(device: AndroidDevice, scenario: VisualScenario): Promise<ScreenshotMask[]> {
  const masks: ScreenshotMask[] = [];
  for (const rule of scenario.fixedTexts.filter(rule => /(?:version-text|current-server-text|checkInDetailDate)/.test(rule.selector))) {
    const node = await device.info(nativeSelector(rule.selector)).catch(() => undefined);
    if (visibleBounds(node)) masks.push(fixedTextMask(node!, rule.selector));
  }
  return masks;
}
/** 控件存在且有可见面积。
 * @param node - 查询结果。
 */
function visibleBounds(node: CaretSample['input'] | undefined): boolean {
  if (!node) return false;
  return node.bounds.width > 0 && node.bounds.height > 0;
}
/** 保留版本区域既有宽度和定位。
 * @param node - 实际控件。
 * @param selector - 固定文本选择器。
 */
function fixedTextMask(node: CaretSample['input'], selector: string): ScreenshotMask {
  return { ...node.bounds, x: 40, width: selector.includes('purchase-history-version-text') ? 660 : 640, reason: selector };
}
/** 仅在指定页面遮住横幅的自动轮播图案。
 * @param device - 专用模拟器。
 * @param scenario - 页面场景。
 * @param backgroundBanner - 打开弹窗前的横幅边界。
 */
async function bannerMasks(device: AndroidDevice, scenario: VisualScenario,
  backgroundBanner: ScreenshotBounds | undefined): Promise<ScreenshotMask[]> {
  if (!['signed_in_hall', 'signed_in_hall_match', 'search_sign_in_prompt', 'guest_game_sign_in_prompt'].includes(scenario.pageLabel)) return [];
  return bannerMask(await bannerBounds(device, backgroundBanner));
}
/** 优先使用打开弹窗前记录的横幅边界。
 * @param device - 专用模拟器。
 * @param backgroundBanner - 已保存边界。
 */
async function bannerBounds(device: AndroidDevice, backgroundBanner: ScreenshotBounds | undefined) {
  if (backgroundBanner) return backgroundBanner;
  return (await device.info({ res: 'slot-banner' }).catch(() => undefined))?.bounds;
}
/** 从真实横幅计算三个图案的最小遮罩。
 * @param banner - 已确认横幅边界。
 */
function bannerMask(banner: ScreenshotBounds | undefined): ScreenshotMask[] {
  if (!banner) return [];
  const { x, y, width, height } = banner;
  return [{ x: x + width * 0.52, y: y + height * 0.16, width: width * 0.4, height: height * 0.48,
    reason: '拉霸横幅自动轮播的三个图案；横幅文字、布局和按钮仍比较' }];
}

/** 拒绝用过大遮罩掩盖整页布局。
 * @param area - 累计遮罩面积。
 * @param picture - 原图尺寸。
 */
function validateMaskArea(area: number, picture: PNG): void {
  if (area > picture.width * picture.height * 0.12) throw new Error('动态遮罩超过截图面积的 12%，需要重新检查覆盖范围。');
}
