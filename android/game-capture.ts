import type { TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { compareScreenshot } from './device';
import { captureChallengeAnimation } from './game-animation';
import { addGameMasks } from './game-capture-masks';
import { gameConnected, gameMarker, gameNodes, gameReady, gameScreenshot, nodesConnecting, type NativeNode } from './game-controls';
import { foregroundPanels } from './game-masks';
import { capturePredictionResult, captureToast } from './game-transient';
import { verifyLoopAnimation } from './loop-animation';
import { captureMovingKeyframes } from './loop-keyframes';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

/**
 * 使原生控件边界及绘制余量落到实际截图的整数像素。
 * @param bounds - 原生控件边界。
 */
function pixelBounds(bounds: ScreenshotBounds): ScreenshotBounds {
  const x = Math.floor(bounds.x), y = Math.floor(bounds.y);
  return {
    x, y, width: Math.ceil(bounds.x + bounds.width) - x,
    height: Math.ceil(bounds.y + bounds.height) - y
  };
}

/**
 * 保留真实牌桌布局，仅遮罩网络延迟、倒计时和循环座位指示箭头等动态区域。
 * @param device - 专用模拟器连接。
 * @param name - 共享场景与状态生成的截图名。
 * @param testInfo - 当前测试报告。
 * @param transientMarker - 仅用于会自动消失的提示，截图前后都必须实际存在。
 * @param expectedAlertMarker - 错误分支已断言内容后，允许截图的特定业务弹窗按钮。
 * @param inputMasks - 已根据真实输入框位移校准的光标区域。
 * @param triggerTransient - 背景遮罩准备完成后触发短时提示，并返回应出现的文字。
 * @param reconnectRetry - 同一张截图已在真实重连结束后重新采集一次。
 */
export async function captureGame(device: AndroidDevice, name: string, testInfo: TestInfo, transientMarker?: string,
  expectedAlertMarker?: string, inputMasks?: ScreenshotMask[], triggerTransient?: () => Promise<string | void>,
  reconnectRetry?: boolean): Promise<void> {
  inputMasks = captureInputMasks(inputMasks);
  validateTrigger(transientMarker, triggerTransient);
  const nodes = await captureNodes(device, transientMarker, expectedAlertMarker);
  const masks: ScreenshotMask[] = [...inputMasks];
  const panels = foregroundPanels(nodes);
  await testInfo.attach(`${name}-native-tree`, { body: JSON.stringify(nodes[0]), contentType: 'application/json' });
  addGameMasks(nodes, panels, masks);
  if (name.endsWith('-zhajinhua-game-challenge-select')) {
    await captureChallengeAnimation(device, name, testInfo, masks);
    return;
  }
  await captureLoops(device, name, testInfo, nodes, masks);
  await capturePrepared({
    device, name, testInfo, transientMarker, expectedAlertMarker, inputMasks,
    triggerTransient, reconnectRetry: Boolean(reconnectRetry), masks
  });
}

type CaptureContext = {
  device: AndroidDevice; name: string; testInfo: TestInfo; transientMarker?: string; expectedAlertMarker?: string;
  inputMasks: ScreenshotMask[]; masks: ScreenshotMask[]; triggerTransient?: () => Promise<string | void>; reconnectRetry: boolean;
};

/** 选择短提示专用采集器或普通页面比较。
 * @param context - 已准备遮罩的采集状态。
 */
async function capturePrepared(context: CaptureContext): Promise<void> {
  const { device, name, testInfo, masks, triggerTransient, transientMarker } = context;
  if (!triggerTransient) { await captureOrdinary(context); return; }
  if (transientMarker === 'toastText1') await captureTriggeredToast(context, triggerTransient);
  else await capturePredictionResult(device, name, testInfo, masks, triggerTransient);
}

/** 普通页面仍检查提示的前后可见性，只对房间重连执行一次重采。
 * @param context - 已准备遮罩的采集状态。
 */
async function captureOrdinary(context: CaptureContext): Promise<void> {
  const { device, name, testInfo, masks, transientMarker, expectedAlertMarker, inputMasks, triggerTransient } = context;
  const hooks = transientHooks(device, transientMarker);
  try {
    await compareScreenshot(device, name, testInfo, masks, hooks.assertTransient, hooks.screenshot);
  } catch (error) {
    if (!await canReconnect(context)) throw error;
    await gameConnected(device, 2_000);
    await captureGame(device, name, testInfo, transientMarker, expectedAlertMarker, inputMasks, triggerTransient, true);
  }
}

/** 保留未指定输入遮罩时的空数组默认值。
 * @param masks - 调用方输入遮罩。
 */
function captureInputMasks(masks: ScreenshotMask[] = []): ScreenshotMask[] { return masks; }

/** 提前准备遮罩仅适用于两个已经核对的短提示。
 * @param marker - 目标提示标记。
 * @param trigger - 当前真实触发器。
 */
function validateTrigger(marker?: string, trigger?: () => Promise<string | void>): void {
  if (!trigger) return;
  if (!['toastText1', 'bet-next-hand-result-amount'].includes(String(marker))) {
    throw new Error('提前准备遮罩仅用于已核对的短时提示。');
  }
}

/** 等待前景转场结束，保留原有连续两次布局一致的断言。
 * @param device - 原生设备。
 * @param nodes - 首次读取的原生树。
 */
async function stablePanels(device: AndroidDevice, nodes: NativeNode[]): Promise<NativeNode[]> {
  if (!foregroundPanels(nodes).length) return nodes;
  let previous = '';
  await expect(async () => {
    nodes = await gameNodes(device);
    const current = JSON.stringify(foregroundPanels(nodes).map(node => node.bounds));
    const before = previous;
    previous = current;
    expect(current, '前景面板边界须完成转场后再裁剪背景遮罩').toBe(before);
  }).toPass({ timeout: 30_000, intervals: [300] });
  return nodes;
}

/** 取得可截图树并校验目标提示和意外错误。
 * @param device - 原生设备。
 * @param marker - 短提示标记。
 * @param alert - 已由业务分支断言的特定提示。
 */
async function captureNodes(device: AndroidDevice, marker?: string, alert?: string): Promise<NativeNode[]> {
  if (alert) await gameReady(device, alert);
  else await gameConnected(device, 1_000);
  let nodes = await gameNodes(device);
  if (waitForPanels(marker)) nodes = await stablePanels(device, nodes);
  assertAlerts(nodes, alert);
  return nodes;
}

/** 校验目标提示已出现且没有意外错误对话框。
 * @param nodes - 当前可见树。
 * @param alert - 已校验的业务提示。
 */
function assertAlerts(nodes: NativeNode[], alert?: string): void {
  if (alert) expect(nodes.some(node => node.res === alert), '目标业务提示必须可见').toBe(true);
  const unexpected = nodes.some(node => node.res === 'android:id/message'
    || unexpectedCommonAlert(node, alert));
  expect(unexpected, '截图前不能存在意外错误提示').toBe(false);
}

/** 只有明确允许的业务提示可出现在截图里。
 * @param node - 当前控件。
 * @param alert - 已校验的业务提示。
 */
function unexpectedCommonAlert(node: NativeNode, alert?: string): boolean {
  return !alert && node.res === 'common-alert-message';
}

/** 判断是否仍有一次普通截图重连恢复机会。
 * @param context - 当前采集状态。
 */
async function canReconnect(context: CaptureContext): Promise<boolean> {
  if ([context.reconnectRetry, context.transientMarker, context.triggerTransient, context.expectedAlertMarker].some(Boolean)) return false;
  return nodesConnecting(await gameNodes(context.device));
}

/** 英文循环动画保留独立的实际运动验证和关键帧附件。
 * @param device - 原生设备。
 * @param name - 截图名称。
 * @param testInfo - 测试报告。
 * @param nodes - 当前可见树。
 * @param masks - 已校准遮罩。
 */
async function captureLoops(device: AndroidDevice, name: string, testInfo: TestInfo,
  nodes: NativeNode[], masks: ScreenshotMask[]): Promise<void> {
  if (!name.startsWith('en-')) return;
  await captureGuides(device, name, testInfo, masks);
  await captureCountdown(device, name, testInfo, nodes, masks);
}

/** 等待开局时空座箭头必须实际运动。
 * @param device - 原生设备。
 * @param name - 英文截图名称。
 * @param testInfo - 测试报告。
 * @param masks - 已校准遮罩。
 */
async function captureGuides(device: AndroidDevice, name: string, testInfo: TestInfo, masks: ScreenshotMask[]): Promise<void> {
  if (!name.endsWith('-pre-game-waiting-table')) return;
  const guides = masks.filter(mask => /^seat-guide-\d+ 完整箭头动画范围$/.test(mask.reason));
  expect(guides.length, '等待开局的空座引导箭头必须可见').toBeGreaterThan(0);
  await verifyLoopAnimation(device, name, testInfo, guides.map(pixelBounds), masks);
}

/** 对手回合保留原生倒计时及其运动关键帧验证。
 * @param device - 原生设备。
 * @param name - 英文截图名称。
 * @param testInfo - 测试报告。
 * @param nodes - 当前可见树。
 * @param masks - 已校准遮罩。
 */
async function captureCountdown(device: AndroidDevice, name: string, testInfo: TestInfo,
  nodes: NativeNode[], masks: ScreenshotMask[]): Promise<void> {
  if (!/-signed-in-(?:texas|zhajinhua)-game-opponent-turn$/.test(name)) return;
  const marker = name.includes('-zhajinhua-') ? 'zhajinhua-active-countdown' : 'texas-holdem-active-countdown';
  const countdown = nodes.filter(node => node.res === marker);
  expect(countdown, '对手行动时必须出现原生倒计时').toHaveLength(1);
  const regions = countdown.map(node => pixelBounds({
    x: node.bounds.x - 2, y: node.bounds.y - 2,
    width: node.bounds.width + 4, height: node.bounds.height + 4
  }));
  await verifyLoopAnimation(device, name, testInfo, regions, masks);
  await captureMovingKeyframes(device, `${name}-countdown`, testInfo, regions);
}

/** Toast 的触发先于其专用采集器，保留原来的预期文字处理。
 * @param context - 已准备的截图状态。
 * @param trigger - 真实触发器。
 */
async function captureTriggeredToast(context: CaptureContext, trigger: () => Promise<string | void>): Promise<void> {
  const expected = await trigger();
  await captureToast(context.device, context.name, context.testInfo, context.masks, expected || undefined);
}

/** 普通页面与升级提示等待前景面板稳定。
 * @param marker - 当前短提示。
 */
function waitForPanels(marker?: string): boolean { return !marker || marker === 'level-up-title'; }

/** 短提示使用快速原生截图并在前后都断言实际可见。
 * @param device - 原生设备。
 * @param transientMarker - 当前短提示。
 */
function transientHooks(device: AndroidDevice, transientMarker?: string): {
  assertTransient?: () => Promise<void>; screenshot?: () => Promise<Buffer>;
} {
  if (!transientMarker) return {};
  /** 不允许把提示消失后的稳定页面当成提示截图。 */
  const assertTransient = async () => {
    expect((await gameMarker(device, transientMarker!))?.text,
      `${transientMarker} 必须在截图前后可见`).toBeTruthy();
  };
  return { assertTransient, screenshot: /** 通过原生快速入口截取短提示。 */ () => gameScreenshot(device) };
}
