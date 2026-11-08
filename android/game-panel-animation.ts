import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { captureNativeTransition, captureTimedPrompt } from './animation-transition';
import { adb } from './device';
import { gameConnected, gameMarker, gameReady, gameTap, gameTapTarget, type NativeNode } from './game-controls';
import { preserveAnimationFailure } from './animation-diagnostics';
import { preserveRulePanelState, tracePanelTarget, type PanelTrace } from './game-panel-diagnostics';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

type SamplingMethod = 'motionFrames' | 'launchFrames' | 'videoFrames';

/** 在采集前固定短弹窗的采样方式，不根据实际图或比较结果切换。
 * @param game - 本轮玩法。
 * @param name - 动效面板名称。
 * @param phase - 入场或退场。
 * @param requested - 其他面板沿用调用方指定的方式。
 */
export function gamePanelSamplingMethod(game: 'texas-holdem' | 'zhajinhua', name: string,
  phase: 'enter' | 'exit', requested: SamplingMethod): SamplingMethod {
  // 带入审核的短缩放/淡入可能落在两次 UiAutomation 截图之间，固定走现有连续录屏。
  return [game === 'texas-holdem', name === 'buy-in-applications', phase === 'enter'].every(Boolean)
    ? 'videoFrames' : requested;
}

/**
 * 在原生牌桌的实际入口点击期间采样面板动效；其他语言复用静态页面截图。
 * @param device - 已安装采样驱动的测试模拟器。
 * @param game - 当前玩法。
 * @param name - 组件对应的动效名称。
 * @param button - 实际可见的入口控件。
 * @param region - 不包含牌桌循环箭头的面板可见区域。
 * @param testInfo - 仅英文牌桌动画场景采集关键帧。
 * @param phase - 入场或退场。
 * @param samplingMethod - 拼三张短弹窗默认持续录屏；其他延迟弹窗也可显式选择采样方式。
 * @param masks - 与面板无关的计时器等动态区域。
 * @param afterReady - 面板加载业务数据后再固定终点画面。
 * @param videoPhaseAnchors - 经原生录屏审查的其他有效相位。
 */
export async function animateGamePanel(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua', name: string,
  button: string, region: ScreenshotBounds, testInfo?: TestInfo, phase?: 'enter' | 'exit',
  samplingMethod?: SamplingMethod,
  masks?: ScreenshotMask[], afterReady?: () => Promise<void>,
  videoPhaseAnchors?: string[]): Promise<void> {
  if (!testInfo) { await gameTap(device, button); return; }
  phase = panelPhase(phase);
  samplingMethod = gamePanelSamplingMethod(game, name, phase, panelSampling(game, samplingMethod));
  const transition = `${game}-${name}-${phase}`;
  const trace: PanelTrace = { testID: button, events: [] };
  /** 记录采集阶段，不在采样期间轮询完整控件树。
   * @param event - 固定阶段名。
   */
  const observe = (event: string) => tracePanelTarget(trace, event);
  const startedAt = Date.now();
  try {
    await gameConnected(device);
    observe('target-query-start');
    const target = await gameTapTarget(device, button, node => tracePanelTarget(trace, 'target-query-result', node));
    const press = panelPress(device, target, trace, liveRuleCheck(transition, samplingMethod));
    await captureNativeTransition(device, transition, testInfo, region, press,
      masks, [], 0, samplingMethod, undefined, afterReady, videoPhaseAnchors,
      [], [], [], undefined, observe);
  } catch (error) {
    await preservePanelFailure(transition, startedAt, testInfo);
    await preserveRuleFailure(device, transition, testInfo);
    throw error;
  } finally {
    await attachRuleTrace(transition, testInfo, trace);
  }
}

/** 录屏就绪后只核对一次规则入口，拒绝使用已移动、禁用或消失的旧坐标。
 * @param device - 原生设备。
 * @param target - 采集前已稳定的入口。
 * @param trace - 当前点击的脱敏时间线。
 * @param verify - 规则入场录屏路径才能即时查询；连续截图期间驱动正忙。
 */
function panelPress(device: AndroidDevice, target: NativeNode,
  trace: PanelTrace, verify: boolean): () => Promise<void> {
  return async () => {
    tracePanelTarget(trace, 'trigger-ready', target);
    if (verify) {
      tracePanelTarget(trace, 'final-query-start');
      const current = await gameMarker(device, trace.testID);
      tracePanelTarget(trace, 'final-query-result', current || undefined);
      assertRuleTarget(current, target);
    }
    const { x, y, width, height } = target.bounds;
    const point = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
    trace.events.push({ event: 'tap', at: Date.now(), point });
    adb('shell', 'input', 'tap', String(point.x), String(point.y));
    tracePanelTarget(trace, 'tap-complete');
  };
}

/** 核对一次即时节点；失败直接抛出，不重新点击或在录制中等待布局。
 * @param current - 录屏启动后即时读取的节点。
 * @param target - 录制前稳定的节点。
 */
function assertRuleTarget(current: NativeNode | null, target: NativeNode): void {
  expect(current, '录屏就绪时规则入口仍应可见').not.toBeNull();
  expect(current!.enabled, '录屏就绪时规则入口仍应可用').not.toBe(false);
  expect(current!.bounds, '录屏准备期间规则入口不能移动，禁止使用旧坐标').toEqual(target.bounds);
}

/** 只在独立录屏期间核对规则入口，避免占用正在连续截图的同一驱动。
 * @param name - 具体转场。
 * @param method - 已固定的采样方式。
 */
function liveRuleCheck(name: string, method: SamplingMethod): boolean {
  return name === 'zhajinhua-game-rule-enter' && method === 'videoFrames';
}

/** 规则入退场保存同一份定向诊断。
 * @param name - 当前转场名。
 */
function ruleTransition(name: string): boolean { return name.startsWith('zhajinhua-game-rule-'); }

/** 规则失败时读取脱敏现场，不覆盖原始错误。
 * @param device - 专用模拟器。
 * @param name - 当前动画。
 * @param info - 独立测试报告。
 */
async function preserveRuleFailure(device: AndroidDevice, name: string, info: TestInfo): Promise<void> {
  if (ruleTransition(name)) await preserveRulePanelState(device, name, info).catch(() => undefined);
}

/** 成败均保存规则入口时间线，供对照首次执行。
 * @param name - 当前动画。
 * @param info - 独立测试报告。
 * @param trace - 只包含入口几何状态的时间线。
 */
async function attachRuleTrace(name: string, info: TestInfo, trace: PanelTrace): Promise<void> {
  if (ruleTransition(name)) await info.attach(`${name}-input-trace`, {
    body: JSON.stringify(trace), contentType: 'application/json',
  }).catch(() => undefined);
}

/** 保存聊天入场与规则面板失败时的既有脱敏日志。
 * @param name - 动画名称。
 * @param startedAt - 开始时间。
 * @param info - 测试报告。
 */
async function preservePanelFailure(name: string, startedAt: number, info: TestInfo): Promise<void> {
  if (name === 'texas-holdem-chat-enter' || ruleTransition(name)) {
    await preserveAnimationFailure(name, startedAt, info).catch(() => undefined);
  }
}

/**
 * 实际按钮触发的升级提示会自动消失；验证显示和倒计时两个真实相位。
 * @param device - 专用 Android 模拟器。
 * @param game - 当前玩法。
 * @param button - 当前可见的操作按钮。
 * @param testInfo - 英文动画基线报告。
 */
export async function captureTimedLevelUp(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua',
  button: string, testInfo: TestInfo): Promise<void> {
  const { bounds } = await gameReady(device, button);
  await captureTimedPrompt(device, `${game}-level-up`, testInfo,
    { x: 0, y: 20, width: 620, height: 230 },
    () => adb('shell', 'input', 'tap', String(Math.round(bounds.x + bounds.width / 2)),
      String(Math.round(bounds.y + bounds.height / 2))));
}

/** 统一未指定的面板动画相位。
 * @param phase - 调用方相位。
 */
function panelPhase(phase: 'enter' | 'exit' = 'enter'): 'enter' | 'exit' { return phase; }

/** 保留两种玩法的默认采样方式。
 * @param game - 当前玩法。
 * @param method - 调用方指定的采样方式。
 */
export function panelSampling(game: 'texas-holdem' | 'zhajinhua', method?: SamplingMethod): SamplingMethod {
  if (method !== undefined) return method;
  return game === 'zhajinhua' ? 'videoFrames' : 'motionFrames';
}
