import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { gameNodes, gameScreenshot, nodesConnecting, type NativeNode } from './game-controls';

export type PanelTrace = { testID: string; events: object[] };

/** 只保存已知 testID 的状态与几何信息，不复制文字、子树或异常载荷。
 * @param trace - 本次真实点击时间线。
 * @param event - 固定的阶段名。
 * @param node - 当前入口节点。
 */
export function tracePanelTarget(trace: PanelTrace, event: string, node?: NativeNode): void {
  trace.events.push({ event, at: Date.now(), target: targetState(node) });
}

/** 脱敏节点状态，避免牌桌身份、聊天和凭据进入新增诊断。
 * @param node - 设备返回的目标节点。
 */
function targetState(node: NativeNode | undefined): object | null {
  if (!node) return null;
  return { enabled: node.enabled, bounds: { ...node.bounds } };
}

/** 保存失败现场；各项采集互不阻断，调用方仍抛出最初错误。
 * @param device - 专用模拟器。
 * @param name - 报告附件前缀。
 * @param info - 本轮独立报告。
 */
export async function preserveRulePanelState(device: AndroidDevice, name: string, info: TestInfo): Promise<void> {
  await gameScreenshot(device).then(body => info.attach(`${name}-failure-screen`, {
    body, contentType: 'image/png',
  })).catch(() => undefined);
  await gameNodes(device).then(nodes => info.attach(`${name}-failure-state`, {
    body: JSON.stringify({ at: Date.now(), connecting: nodesConnecting(nodes),
      markers: ruleMarkers(nodes) }), contentType: 'application/json',
  })).catch(() => undefined);
}

/** 只记录与规则入口和弹窗有关的标记，缺失时显式保留 null。
 * @param nodes - 失败时的可见控件。
 */
function ruleMarkers(nodes: NativeNode[]): object {
  return Object.fromEntries(['menu-button', 'drawer-menu-item-exit', 'drawer-menu-item-game_rule',
    'game-rule-popup', 'game-rule-popup-close-button'].map(res =>
    [res, targetState(nodes.find(node => node.res === res))]));
}
