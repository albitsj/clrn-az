import { expect, type TestInfo } from '@playwright/test';
import { setTimeout } from 'node:timers/promises';
import type { AndroidDevice } from 'playwright';
import type { NativeNode } from './game-controls';
import { subtractPanel } from './game-masks';
import { samePixels } from './motion-regions';
import { maskScreenshot, type ScreenshotMask } from './screenshot';

type Frame = { before: NativeNode; after: NativeNode; panel: NativeNode | null; capturedAt: number; png: string };

/**
 * 在设备上连续采集短时提示，先检查节点与真实位图，再编码传回；不延长提示或改变动画。
 * @param device - 固定原生驱动连接。
 * @param name - 共用场景的截图名。
 * @param testInfo - 当前测试报告。
 * @param backgroundMasks - 提示出现前准备的背景动态区域。
 * @param resource - 短时提示的原生标记。
 * @param expectedText - 操作分支应出现的语义文字。
 * @param trigger - 准备完背景后触发提示；采集先于触发开始。
 * @param requirePanel - 提示必须有独立前景面板。
 */
async function captureTransient(device: AndroidDevice, name: string, testInfo: TestInfo,
  backgroundMasks: ScreenshotMask[], resource: string, expectedText?: string,
  trigger?: () => Promise<string | void>, requirePanel?: boolean): Promise<void> {
  const collected = await transientFrames(device, resource, expectedText, trigger);
  const frames = collected.frames;
  expectedText = collected.expectedText;
  await testInfo.attach(`${name}-frames`, {
    body: JSON.stringify(frames.map(({ png: _png, ...metadata }) => metadata)), contentType: 'application/json',
  });
  expect(frames.length, '提示可见时必须采集至少两帧真实屏幕').toBeGreaterThanOrEqual(2);
  const state: TransientState = { stableSince: 0 };
  for (const [index, frame] of frames.entries()) {
    validateTransientFrame(frame, resource, expectedText, requirePanel);
    const current = await transientFrameImage(frame, backgroundMasks, name, index, testInfo);
    updateTransientStability(state, frame, current);
  }
  const stable = state.stable;
  expect(stable, '提示存在期间全部未遮罩像素必须连续稳定至少 250 毫秒').toBeDefined();
  await testInfo.attach(name, { body: stable!, contentType: 'image/png' });
  expect.soft(stable!).toMatchSnapshot(`${name}.png`);
}

/**
 * 采集真实浮层文字并核对显示期间的稳定画面。
 * @param device - 固定原生驱动连接。
 * @param name - 共用场景的截图名。
 * @param testInfo - 当前测试报告。
 * @param backgroundMasks - 提示出现前准备的背景动态区域。
 * @param expectedText - 操作分支应出现的语义文字。
 */
export async function captureToast(device: AndroidDevice, name: string, testInfo: TestInfo,
  backgroundMasks: ScreenshotMask[], expectedText?: string): Promise<void> {
  await captureTransient(device, name, testInfo, backgroundMasks, 'toastText1', expectedText, undefined, true);
}

/**
 * 在回放预测结果前启动采集，核对金额和真实截图。
 * @param device - 固定原生驱动连接。
 * @param name - 共用场景的截图名。
 * @param testInfo - 当前测试报告。
 * @param backgroundMasks - 结果出现前准备的背景动态区域。
 * @param trigger - 发送本轮预测结果并返回预期金额。
 */
export async function capturePredictionResult(device: AndroidDevice, name: string, testInfo: TestInfo,
  backgroundMasks: ScreenshotMask[], trigger: () => Promise<string | void>): Promise<void> {
  await captureTransient(device, name, testInfo, backgroundMasks, 'bet-next-hand-result-amount', undefined, async () => {
    const expected = await trigger();
    if (!expected) throw new Error('预测结果必须指定预期金额。');
    return expected;
  });
}

/** 在触发前启动原生采集，保留超时、错误传播及控制器清理。
 * @param device - 原生设备。
 * @param resource - 提示标记。
 * @param expectedText - 调用方预期文字。
 * @param trigger - 真实事件触发器。
 */
async function transientFrames(device: AndroidDevice, resource: string, expectedText?: string,
  trigger?: () => Promise<string | void>): Promise<{ frames: Frame[]; expectedText?: string }> {
  const implementation = (device as unknown as {
    _connection: {
      toImpl(device: AndroidDevice): {
        _send(method: string, params: { resource: string }): Promise<Frame[]>
      }
    }
  })._connection.toImpl(device);
  const timeout = new AbortController();
  let frames: Frame[];
  const pending = implementation._send('transientFrames', { resource });
  pending.catch(() => undefined);
  try {
    expectedText = await trigger?.() || expectedText;
    frames = await Promise.race([
      pending,
      setTimeout(30_000, undefined, { signal: timeout.signal }).then(() => { throw new Error('原生短时截图采集超时。'); }),
    ]);
  } finally { timeout.abort(); }
  return { frames, expectedText };
}

/** 每帧都校验前后文字与独立面板。
 * @param frame - 原生采集帧。
 * @param resource - 提示标记。
 * @param expectedText - 业务预期文字。
 * @param requirePanel - 是否要求独立前景面板。
 */
function validateTransientFrame(frame: Frame, resource: string, expectedText?: string, requirePanel?: boolean): void {
  expect(frame.before.text, '截图前提示必须可见').toBeTruthy();
  expect(frame.after.text, '截图后提示文字必须保持一致').toBe(frame.before.text);
  if (expectedText) assertTransientText(frame.before.text, resource, expectedText);
  if (requirePanel) expect(frame.panel, '提示面板不能被背景遮罩覆盖').toBeTruthy();
}

/** Toast 包含业务文字，预测结果则必须与金额完全一致。
 * @param actual - 实际原生文字。
 * @param resource - 提示标记。
 * @param expected - 业务预期。
 */
function assertTransientText(actual: string | undefined, resource: string, expected: string): void {
  if (resource === 'toastText1') expect(actual).toContain(expected);
  else expect(actual, '预测结果金额必须与回放事件一致').toBe(expected);
}

/** 保留原始帧和遮罩诊断附件，提示面板自身不被背景遮罩覆盖。
 * @param frame - 原生采集帧。
 * @param backgroundMasks - 背景动态遮罩。
 * @param name - 截图名。
 * @param index - 当前帧序号。
 * @param testInfo - 测试报告。
 */
async function transientFrameImage(frame: Frame, backgroundMasks: ScreenshotMask[], name: string,
  index: number, testInfo: TestInfo): Promise<Buffer> {
  const panel = frame.panel;
  const masks = panel ? backgroundMasks.flatMap(mask => subtractPanel(mask, panel.bounds)) : backgroundMasks;
  const original = Buffer.from(frame.png, 'base64');
  const current = maskScreenshot(original, masks);
  await testInfo.attach(`${name}-frame-${index}-original`, { body: original, contentType: 'image/png' });
  await testInfo.attach(`${name}-frame-${index}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  return current;
}

type TransientState = { reference?: Buffer; stableSince: number; stable?: Buffer };

/** 布局发生变化时废弃连续稳定参考，保留此前已采到的稳定结果。
 * @param state - 连续稳定状态。
 * @param frame - 原生采集帧。
 * @param current - 当前遮罩图。
 */
function updateTransientStability(state: TransientState, frame: Frame, current: Buffer): void {
  if (JSON.stringify(frame.before.bounds) !== JSON.stringify(frame.after.bounds)) {
    state.reference = undefined;
    return;
  }
  updateStablePixels(state, frame.capturedAt, current);
}

/** 未遮罩像素必须在提示仍可见期间连续稳定至少 250ms。
 * @param state - 连续稳定状态。
 * @param capturedAt - 原生帧采集时间。
 * @param current - 当前遮罩图。
 */
function updateStablePixels(state: TransientState, capturedAt: number, current: Buffer): void {
  if (!state.reference || !samePixels(current, state.reference)) {
    state.reference = current;
    state.stableSince = capturedAt;
    return;
  }
  retainStableFrame(state, capturedAt, current);
}

/** 只保留达到原有连续稳定窗口的帧。
 * @param state - 稳定状态。
 * @param capturedAt - 实际采集时间。
 * @param current - 当前图像。
 */
function retainStableFrame(state: TransientState, capturedAt: number, current: Buffer): void {
  if (capturedAt - state.stableSince >= 250) state.stable = current;
}
