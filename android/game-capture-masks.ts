import { expect } from '@playwright/test';
import presentation from '../visual/fixtures/game-presentation.json';
import type { NativeNode } from './game-controls';
import { countdownMask, networkStatusMask, visibleMasks } from './game-masks';
import type { ScreenshotMask } from './screenshot';

type MaskContext = { node: NativeNode; add(mask: ScreenshotMask): number };
type MaskRule = { matches(node: NativeNode): boolean; apply(context: MaskContext): void; stop?: boolean };

/** 只排除可见动态控件，前景的真实内容继续逐像素比较。
 * @param nodes - 当前原生树。
 * @param panels - 已定位的前景。
 * @param masks - 调用方准备的遮罩，追加原生动态区域。
 */
export function addGameMasks(nodes: NativeNode[], panels: NativeNode[], masks: ScreenshotMask[]): void {
  for (const node of nodes) {
    applyMaskRules({
      node, add: /** 将遮罩裁剪到当前真实前景之外。
     * @param mask - 当前动态区域。
     */
        mask => masks.push(...visibleMasks(mask, node, panels))
    });
  }
}

/** 保持规则顺序及命中后跳过后续规则的语义。
 * @param context - 当前控件及可见遮罩写入器。
 */
function applyMaskRules(context: MaskContext): void {
  for (const rule of rules) {
    if (applyRule(rule, context)) return;
  }
}

const rules: MaskRule[] = [
  {
    matches: /** 匹配当前已登记的动态控件。
     * @param node - 当前原生节点。
     */
      node => ['texas-holdem-room-id-text', 'zhajinhua-room-id-text'].includes(node.res || ''),
    apply: /** 校验此动态控件并只加入它的可见遮罩。
     * @param context - 当前节点及遮罩写入器。
     */
      ({ node }) => { expect(node.text, '房号展示应与 Web 共用夹具一致').toBe(presentation.roomNumber); },
    stop: true,
  },
  {
    matches: /** 匹配当前已登记的动态控件。
     * @param node - 当前原生节点。
     */
      node => /^seat-guide-\d+$/.test(node.res || ''),
    apply: /** 校验此动态控件并只加入它的可见遮罩。
     * @param context - 当前节点及遮罩写入器。
     */
      ({ node, add }) => {
        // Android 裁短越出父节点的箭头；按 24×20 图案及 11dp 行程还原。
        const scale = node.bounds.width / 24;
        const height = 20 * scale;
        add({
          x: node.bounds.x - 1, y: node.bounds.y + node.bounds.height - height - 1,
          width: node.bounds.width + 2, height: height + 22 + 2, reason: `${node.res} 完整箭头动画范围`
        });
      },
    stop: true,
  },
  {
    matches: /** 匹配当前已登记的动态控件。
     * @param node - 当前原生节点。
     */
      node => /^(texas-holdem|zhajinhua)-active-countdown$/.test(node.res || '') || node.res === 'seat-progress-pie',
    apply: /** 校验此动态控件并只加入它的可见遮罩。
     * @param context - 当前节点及遮罩写入器。
     */
      ({ node, add }) => {
        // API 35 向下取整；右侧两像素仍有填充变化。
        add({
          x: node.bounds.x - 2, y: node.bounds.y - 2, width: node.bounds.width + 4, height: node.bounds.height + 4,
          reason: `${node.res} 含两像素绘制边缘`
        });
      },
    stop: true,
  },
  {
    matches: /** 匹配当前已登记的动态控件。
     * @param node - 当前原生节点。
     */
      node => node.res === 'leader-board-room-id',
    apply: /** 校验此动态控件并只加入它的可见遮罩。
     * @param context - 当前节点及遮罩写入器。
     */
      ({ node, add }) => {
        expect(node.text).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
        add({ ...node.bounds, x: Math.round(node.bounds.x + node.bounds.width / 2) - 220, width: 440, reason: node.res! });
      },
    stop: true,
  },
  {
    matches: /** 匹配当前已登记的动态控件。
     * @param node - 当前原生节点。
     */
      node => node.res === 'view-community-cards-countdown',
    apply: /** 校验此动态控件并只加入它的可见遮罩。
     * @param context - 当前节点及遮罩写入器。
     */
      ({ node, add }) => { add(countdownMask(node.bounds, node.text || '')); },
    stop: true,
  },
  {
    matches: dynamicLabel,
    apply: /** 校验此动态控件并只加入它的可见遮罩。
     * @param context - 当前节点及遮罩写入器。
     */
      ({ node, add }) => { add({ ...node.bounds, reason: dynamicReason(node) }); },
  },
  {
    matches: /** 匹配当前已登记的动态控件。
     * @param node - 当前原生节点。
     */
      node => node.res === 'ping-screen-container',
    apply: /** 校验此动态控件并只加入它的可见遮罩。
     * @param context - 当前节点及遮罩写入器。
     */
      ({ node, add }) => { add(networkStatusMask(node.bounds)); },
  },
];

/** 匹配明确登记的动态文字来源。
 * @param node - 当前原生控件。
 */
function dynamicLabel(node: NativeNode): boolean {
  return [node.res === 'game-network-proxy-code', /^\d{1,2}:\d{2}(?::\d{2})?$/.test(node.text || ''),
  secondsLabel(node), node.res === 'player-profile-id', roomUuid(node)].some(Boolean);
}

/** Android 独立秒数计时器。
 * @param node - 当前原生控件。
 */
function secondsLabel(node: NativeNode): boolean {
  return node.res === 'countdown_timer_text' && /^\d+s$/.test(node.text || '');
}

/** 无资源标记的本轮真实房间 UUID。
 * @param node - 当前原生控件。
 */
function roomUuid(node: NativeNode): boolean {
  return !node.res && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(node.text || '');
}

/** 保留遮罩的原始诊断原因。
 * @param node - 当前原生控件。
 */
function dynamicReason(node: NativeNode): string {
  if (node.res) return node.res;
  return String(node.text).includes(':') ? '保座或加时冷却倒计时' : '本轮真实房间 UUID';
}

/** 未命中时继续，命中后执行规则并遵守停止标志。
 * @param rule - 当前遮罩规则。
 * @param context - 当前节点及写入器。
 */
function applyRule(rule: MaskRule, context: MaskContext): boolean {
  if (!rule.matches(context.node)) return false;
  rule.apply(context);
  return Boolean(rule.stop);
}
