import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { NativeNode } from './game-controls';

export type TransientFrame = {
  before: NativeNode; after: NativeNode; panel: NativeNode | null; capturedAt: number; png: string
};
type Window = { token: string; events: { event: string; at: number }[] };

/** 在设备确认进入采集循环后才发送一次事件，保留原有帧数与稳定性要求。
 * @param device - 使用补丁驱动的模拟器。
 * @param resource - 固定提示标记。
 * @param expectedText - 当前预期文字。
 * @param trigger - 可选的单次业务事件。
 * @param report - 仅包含固定名称和报告边界。
 */
export async function collectTransientFrames(device: AndroidDevice, resource: string, expectedText: string | undefined,
  trigger: (() => Promise<string | void>) | undefined, report: { name: string; info: TestInfo }):
  Promise<{ frames: TransientFrame[]; expectedText?: string }> {
  const window: Window = { token: randomUUID(), events: [] };
  const timeout = new AbortController();
  mark(window, 'requested');
  const pending = nativeFrames(device, resource, window.token);
  // 即使触发失败或等待就绪超时，驱动的后续拒绝也不能成为未处理异常。
  pending.catch(() => undefined);
  try {
    if (trigger) await samplerReady(device, window, pending, timeout.signal);
    const text = await triggerOnce(trigger, expectedText, window);
    const frames = await Promise.race([pending, expired(timeout.signal, 30_000)]);
    mark(window, 'collected');
    return { frames, expectedText: text };
  } finally {
    timeout.abort();
    await attachWindow(device, window, report).catch(() => undefined);
  }
}

/** 通过现有驱动协议开始采集，不把发送成功当作设备已经就绪。
 * @param device - 原生设备。
 * @param resource - 提示标记。
 * @param readyToken - 不包含用户信息的本次随机标记。
 */
function nativeFrames(device: AndroidDevice, resource: string, readyToken: string): Promise<TransientFrame[]> {
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string, params: object): Promise<TransientFrame[]> } } })._connection.toImpl(device);
  return implementation._send('transientFrames', { resource, readyToken });
}

/** 就绪确认通过独立 ADB shell 读取，不能向忙碌的驱动排队查询。
 * @param device - 原生设备。
 * @param window - 本次脱敏采集时间线。
 * @param pending - 正在执行的真实采集。
 * @param signal - 当前会话的清理信号。
 */
async function samplerReady(device: AndroidDevice, window: Window, pending: Promise<TransientFrame[]>,
  signal: AbortSignal): Promise<void> {
  await Promise.race([
    waitReady(device, window.token, signal),
    pending.then(() => { throw new Error('原生采集在事件触发前已经结束，禁止发送过期事件。'); }),
    expired(signal, 3_000),
  ]);
  mark(window, 'device-ready');
}

/** 会话结束时停止只读轮询，不留下后台日志查询。
 * @param device - 原生设备。
 * @param token - 本轮随机标记。
 * @param signal - 会话取消信号。
 */
async function waitReady(device: AndroidDevice, token: string, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    if ((await readinessLog(device)).split(/\r?\n/).includes(token)) return;
    await setTimeout(50, undefined, { signal });
  }
  throw new Error('原生采集就绪确认已取消。');
}

/** 触发边界只执行一次，不重放业务事件。
 * @param trigger - 当前业务触发器。
 * @param expected - 未提供触发器时的原有预期。
 * @param window - 当前时间线。
 */
async function triggerOnce(trigger: (() => Promise<string | void>) | undefined, expected: string | undefined,
  window: Window): Promise<string | undefined> {
  if (!trigger) return expected;
  mark(window, 'trigger-start');
  const result = await trigger();
  mark(window, 'trigger-complete');
  return result || expected;
}

/** 保持固定超时，失败时禁止继续触发。
 * @param signal - 会话结束时取消计时器。
 * @param duration - 当前阶段截止时间。
 */
async function expired(signal: AbortSignal, duration: number): Promise<never> {
  await setTimeout(duration, undefined, { signal });
  throw new Error('原生短时截图采集或就绪确认超时。');
}

/** 只读取专用就绪标签，不复制其他应用日志。
 * @param device - 原生设备。
 */
async function readinessLog(device: AndroidDevice): Promise<string> {
  const timeout = new AbortController();
  try {
    return await Promise.race([
      device.shell('logcat -d -v raw -s ClrnTransientReady:I').then(body => body.toString()),
      expired(timeout.signal, 1_000),
    ]);
  } finally { timeout.abort(); }
}

/** 记录宿主阶段时间。
 * @param window - 本次时间线。
 * @param event - 固定阶段名。
 */
function mark(window: Window, event: string): void { window.events.push({ event, at: Date.now() }); }

/** 附加本次随机标记对应的状态计数，诊断失败不覆盖采集错误。
 * @param device - 原生设备。
 * @param window - 本次时间线。
 * @param report - 当前报告。
 */
async function attachWindow(device: AndroidDevice, window: Window,
  report: { name: string; info: TestInfo }): Promise<void> {
  const log = await readinessLog(device).catch(() => '');
  const native = log.split(/\r?\n/).filter(line => line.startsWith(`${window.token}:`)).slice(-5);
  await report.info.attach(`${report.name}-capture-window`, {
    body: JSON.stringify({ events: window.events, native }), contentType: 'application/json',
  });
}
