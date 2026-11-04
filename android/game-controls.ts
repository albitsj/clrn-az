import { expect } from '@playwright/test';
import { setTimeout } from 'node:timers/promises';
import type { AndroidDevice } from 'playwright';
import { adb } from './device';
import type { ScreenshotBounds } from './screenshot';

export type NativeNode = {
  res?: string; text?: string; enabled?: boolean; checked?: boolean;
  bounds: ScreenshotBounds; children?: NativeNode[]
};

/**
 * 直接由 UiAutomation 截取真实屏幕，避免每帧启动 screencap 进程错过短时提示。
 * @param device - 使用固定补丁驱动的模拟器连接。
 */
export async function gameScreenshot(device: AndroidDevice): Promise<Buffer> {
  const implementation = (device as unknown as {
    _connection: {
      toImpl(device: AndroidDevice): {
        _send(method: string): Promise<string>
      }
    }
  })._connection.toImpl(device);
  const timeout = new AbortController();
  try {
    const encoded = await Promise.race([
      implementation._send('screen'),
      setTimeout(30_000, undefined, { signal: timeout.signal }).then(() => { throw new Error('原生截图超时。'); }),
    ]);
    const png = Buffer.from(encoded, 'base64');
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('原生截图没有返回 PNG。');
    return png;
  } finally { timeout.abort(); }
}

/**
 * 快速读取一个真实提示节点，用于截图前后的短时可见性断言。
 * @param device - 使用固定补丁驱动的模拟器连接。
 * @param resource - 提示控件标记。
 */
export async function gameMarker(device: AndroidDevice, resource: string): Promise<NativeNode | null> {
  const implementation = (device as unknown as {
    _connection: {
      toImpl(device: AndroidDevice): {
        _send(method: string, parameters: { resource: string }): Promise<NativeNode | null>
      }
    }
  })._connection.toImpl(device);
  const timeout = new AbortController();
  try {
    const node = await Promise.race([
      implementation._send('marker', { resource }),
      setTimeout(5000, undefined, { signal: timeout.signal }).then(() => { throw new Error('原生提示节点查询超时。'); }),
    ]);
    return node && flattenNodes(node).length ? node : null;
  } finally { timeout.abort(); }
}

/**
 * 一次读取原生无障碍树，避免重复 ID 及动画期间逐字段查询导致长时间阻塞。
 * 固定的 Playwright 1.61.1 驱动已提供 tree 命令；协议变化时明确失败。
 * @param device - 本机进程内创建的原生驱动连接。
 */
export async function gameNodes(device: AndroidDevice): Promise<NativeNode[]> {
  const state = { connectionRetries: 0 };
  for (let attempt = 0;; attempt++) {
    const timeout = new AbortController();
    try {
      const nodes = await readTreeAttempt(device, timeout, attempt, state);
      if (nodes) return nodes;
    } finally { timeout.abort(); }
  }
}

/**
 * 只返回有实际可见面积的节点，排除保留在屏幕外的历史弹层。
 * @param root - 原生无障碍树。
 */
export function flattenNodes(root: NativeNode): NativeNode[] {
  return [root, ...(root.children || []).flatMap(flattenNodes)]
    .filter(node => visibleBounds(node.bounds));
}

/**
 * 从已确认可见的容器读取语义文字，保留 Android 裁到容器外的透明辅助节点。
 * @param root - 当前可见玩家或牌面容器，不能传入整棵窗口树。
 * @param marker - 明确指定的辅助文字标记。
 */
export function gameSemanticText(root: NativeNode | undefined, marker: string): string | undefined {
  if (!root) return undefined;
  if (root.res === marker) return root.text;
  return childSemanticText(root.children, marker);
}

/**
 * 读取可见容器边界内的控件，兼容 Fabric 把内容压平为容器兄弟节点的情况。
 * @param nodes - 本次完整查询得到的可见控件。
 * @param marker - 要限定的真实容器标记。
 */
export function gameNodesWithin(nodes: NativeNode[], marker: string): NativeNode[] {
  const container = nodes.find(node => node.res === marker)?.bounds;
  if (!container) return [];
  return nodes.filter(({ bounds }) => withinAxis(bounds.x, bounds.width, container.x, container.width)
    && withinAxis(bounds.y, bounds.height, container.y, container.height));
}

/**
 * 读取真实容器边界内的全部可见文字。
 * @param nodes - 本次完整查询得到的可见控件。
 * @param marker - 要限定的真实容器标记。
 */
export function gameTextWithin(nodes: NativeNode[], marker: string): string[] {
  return gameNodesWithin(nodes, marker).filter(node => node.text).map(node => node.text!);
}

/**
 * 等待实际可见的游戏控件；空查询不会吞掉驱动错误。
 * @param device - 专用模拟器连接。
 * @param res - 与 Web 共用的 testID。
 * @param text - 可选的就绪文字。
 */
export async function gameReady(device: AndroidDevice, res: string, text?: string): Promise<NativeNode> {
  let found: NativeNode | undefined;
  await expect(async () => {
    found = (await gameNodes(device)).find(node => node.res === res && (text === undefined || node.text === text));
    expect(found, `${res} 应可见`).toBeDefined();
  }).toPass({ timeout: 45_000, intervals: [250] });
  return found!;
}

/**
 * 等待游戏弹层完全移出屏幕。
 * @param device - 专用模拟器连接。
 * @param res - 弹层标记。
 */
export async function gameGone(device: AndroidDevice, res: string): Promise<void> {
  await expect.poll(async () => (await gameNodes(device)).some(node => node.res === res),
    { timeout: 45_000, intervals: [250] }).toBe(false);
}

/** 等待房间重连遮罩退去并确认牌桌至少一秒内持续可操作。
 * @param device - 专用模拟器连接。
 * @param stableMs - 指定入口需要额外连续无重连遮罩的时间。
 */
export async function gameConnected(device: AndroidDevice, stableMs?: number): Promise<void> {
  stableMs = stableDuration(stableMs);
  const initial = await gameNodes(device);
  if (!stableMs && !nodesConnecting(initial)) return;
  let availableSince = 0;
  await expect.poll(async () => {
    const connecting = nodesConnecting(await gameNodes(device));
    availableSince = connectionStart(connecting, availableSince);
    return !connecting && Date.now() - availableSince >= Math.max(1_000, stableMs);
  }, { timeout: 120_000, intervals: [250] }).toBe(true);
}

/**
 * 根据两次一致的真实布局点击控件，使用 adb 输入避免驱动等待循环动画空闲。
 * @param device - 专用模拟器连接。
 * @param res - 与 Web 共用的 testID。
 * @param nativeInput - 短时提示使用现有驱动点击，避免启动 shell 输入进程耗尽显示时间。
 */
export async function gameTap(device: AndroidDevice, res: string, nativeInput = false): Promise<void> {
  console.log(`ANDROID > 游戏点击 ${res}`);
  await gameConnected(device);
  let previous: ScreenshotBounds | undefined;
  let node: NativeNode;
  await expect(async () => {
    node = await gameReady(device, res);
    const before = previous;
    previous = node.bounds;
    expect(node.enabled).not.toBe(false);
    expect(previous).toEqual(before);
  }).toPass({ timeout: 45_000, intervals: [200] });
  const { x, y, width, height } = node!.bounds;
  const point = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
  if (nativeInput) await device.input.tap(point);
  else adb('shell', 'input', 'tap', String(point.x), String(point.y));
}

/** 检查原生边界的面积和屏幕交集。
 * @param bounds - 当前节点边界。
 */
function visibleBounds(bounds: ScreenshotBounds): boolean {
  return [bounds.width > 0, bounds.height > 0, bounds.x < 720, bounds.y < 1280,
  bounds.x + bounds.width > 0, bounds.y + bounds.height > 0].every(Boolean);
}

/** 检查一个方向是否完全包含在容器内。
 * @param start - 节点起点。
 * @param size - 节点长度。
 * @param outerStart - 容器起点。
 * @param outerSize - 容器长度。
 */
function withinAxis(start: number, size: number, outerStart: number, outerSize: number): boolean {
  return start >= outerStart && start + size <= outerStart + outerSize;
}

/** 遍历语义子树并保留第一个已定义的文字（包括空文字）。
 * @param children - 原生子节点。
 * @param marker - 目标语义标记。
 */
function childSemanticText(children: NativeNode[] | undefined, marker: string): string | undefined {
  if (!children) return undefined;
  return firstSemanticText(children, marker);
}

/** 保持深度优先且命中即停止，不读取后续子树。
 * @param children - 已确认存在的子节点。
 * @param marker - 语义标记。
 */
function firstSemanticText(children: NativeNode[], marker: string): string | undefined {
  for (const child of children) {
    const value = gameSemanticText(child, marker);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** 识别原生房间重连提示。
 * @param nodes - 当前可见树。
 */
export function nodesConnecting(nodes: NativeNode[]): boolean {
  return nodes.some(node => /Connecting\.\.\./.test(node.text || ''));
}

/** 更新连续无重连提示的起始时间。
 * @param connecting - 是否正在重连。
 * @param previous - 上次起始时间。
 */
function connectionStart(connecting: boolean, previous: number): number {
  if (connecting) return 0;
  return previous || Date.now();
}

/** 读取完整原生树，拒绝协议错误和超时。
 * @param device - 原生设备。
 * @param timeout - 当前读取的超时控制器。
 */
async function readGameTree(device: AndroidDevice, timeout: AbortController): Promise<NativeNode[]> {
  const internal = device as unknown as {
    _connection: {
      toImpl(device: AndroidDevice): {
        _send(method: string): Promise<NativeNode>
      }
    }
  };
  // 内部协议不受 device.setDefaultTimeout 约束；断连时不能一直等到整例超时。
  const root = await Promise.race([
    internal._connection.toImpl(device)._send('tree'),
    setTimeout(30_000, undefined, { signal: timeout.signal }).then(() => {
      throw new Error('原生控件树查询超过 30 秒，驱动未响应。');
    }),
  ]);
  if (!completeTree(root)) throw new Error('原生驱动没有返回完整控件树。');
  return flattenNodes(root);
}

/** 只匹配明确的 Staging 超时对话框和 RETRY 按钮。
 * @param nodes - 当前可见树。
 */
function connectionRetry(nodes: NativeNode[]): NativeNode | undefined {
  const timeoutAlert = nodes.some(node => node.res?.endsWith(':id/alert_title')
    && node.text === 'Connection Timeout');
  if (!timeoutAlert) return undefined;
  return nodes.find(node => node.res === 'android:id/button1' && node.text === 'RETRY');
}

/** 通过真实按钮恢复连接，保留三次上限。
 * @param retry - 当前原生 RETRY 按钮。
 * @param attempt - 已执行的重连次数。
 */
async function retryConnection(retry: NativeNode, attempt: number): Promise<void> {
  if (attempt > 3) throw new Error('Staging 连接超时，对话框重试三次后仍未恢复。');
  console.log(`ANDROID > Staging 连接超时，点击原生 RETRY（${attempt}/3）`);
  const { x, y, width, height } = retry.bounds;
  adb('shell', 'input', 'tap', String(Math.round(x + width / 2)), String(Math.round(y + height / 2)));
  await setTimeout(1_000);
}

/** 完整树协议必须同时包含边界和子节点数组。
 * @param root - 驱动返回值。
 */
function completeTree(root: NativeNode): boolean {
  return Boolean(root?.bounds) && Array.isArray(root.children);
}

/** 未指定稳定窗口时保留原有零值。
 * @param duration - 调用方窗口。
 */
function stableDuration(duration = 0): number { return duration; }

/** 仅转场移除节点的两类驱动错误允许重读。
 * @param device - 原生设备。
 * @param timeout - 当前查询的超时控制器。
 * @param attempt - 当前树读取序号。
 * @param state - 真实连接重试计数。
 */
async function readTreeAttempt(device: AndroidDevice, timeout: AbortController, attempt: number,
  state: { connectionRetries: number }): Promise<NativeNode[] | undefined> {
  try {
    const nodes = await readGameTree(device, timeout);
    if (await retryTreeConnection(nodes, device, state)) return undefined;
    return nodes;
  }
  catch (error) {
    assertTreeRetry(attempt, error);
    await setTimeout(250);
    return undefined;
  }
}

/** 保留原有五次读取及明确异常条件。
 * @param attempt - 当前树读取序号。
 * @param error - 原始驱动错误。
 */
function assertTreeRetry(attempt: number, error: unknown): void {
  if (attempt >= 4 || !/NullPointerException|StaleObjectException/.test(String(error))) throw error;
}

/** 只对明确的原生超时对话框点击 RETRY，跨遍历异常保留同一重试计数。
 * @param nodes - 本次完整树。
 * @param device - 原生设备。
 * @param state - 当前真实连接重试计数。
 */
async function retryTreeConnection(nodes: NativeNode[], device: AndroidDevice, state: { connectionRetries: number }): Promise<boolean> {
  const retry = connectionRetry(nodes);
  if (!retry) return false;
  await retryConnection(retry, ++state.connectionRetries);
  return true;
}
