import type { AndroidDevice } from 'playwright';
import { adb } from './device-command';
import { exists, waitAbsent } from './native-state';
import type { VisualScenario } from '../visual/scenarioTypes';
import type { ScreenshotBounds } from './screenshot';
import { tap } from './navigation-tap';
import { reveal } from './navigation-reveal';
import { returnToTabs } from './navigation-tabs';
import { closeGamePicker } from './navigation-picker';
import { fillScenarioInputs } from './form-inputs';
import { dismissKeyboard } from './keyboard';
import { nativeSelector } from './scenarios';
import { scrollToEnd } from './scroll-end';

/**
 * 从主标签按共享步骤进入页面，等待真实就绪控件和转场结束。
 * @param device - 专用模拟器连接。
 * @param scenario - Web 与 Android 共用的业务场景。
 */
export async function navigateScenario(device: AndroidDevice, scenario: VisualScenario): Promise<ScreenshotBounds | undefined> {
  await returnToTabs(device);
  await tap(device, scenario.tabTestId || 'hall-tab');
  await resetScenarioScroll(device);
  const { inputsFilled, backgroundBanner } = await clickScenarioPath(device, scenario);
  if (!inputsFilled) await fillScenarioInputs(device, scenario);
  await finishScenario(device, scenario);
  return backgroundBanner;
}

/** 回到标签页列表顶部，保持原有三次滑动。
 * @param device - 原生设备。
 */
async function resetScenarioScroll(device: AndroidDevice): Promise<void> {
  // 标签页保留上次滚动位置；完整回到顶部后再按共享路径导航。
  for (let reset = 0; reset < 3; reset++) {
    const list = await device.info({ scrollable: true }).catch(() => undefined);
    if (!list) break;
    const { bounds } = list;
    const horizontal = Math.round(bounds.x + bounds.width / 2);
    adb('shell', 'input', 'swipe', String(horizontal), String(Math.round(bounds.y + bounds.height * 0.2)),
      String(horizontal), String(Math.round(bounds.y + bounds.height * 0.85)), '600');
  }
}

/** 执行完整共享路径，并保留输入已填写与弹窗背景边界。
 * @param device - 原生设备。
 * @param scenario - 共享场景。
 */
async function clickScenarioPath(device: AndroidDevice, scenario: VisualScenario): Promise<{
  inputsFilled: boolean; backgroundBanner: ScreenshotBounds | undefined;
}> {
  const state = { inputsFilled: false, backgroundBanner: undefined as ScreenshotBounds | undefined };
  for (const identifier of scenario.navClickTestIds) await runScenarioStep(device, scenario, identifier, state);
  return state;
}

/** 每一步的前置操作保持原有顺序。
 * @param device - 原生设备。
 * @param scenario - 共享场景。
 * @param identifier - 当前按钮。
 * @param state - 路径执行结果。
 */
async function runScenarioStep(device: AndroidDevice, scenario: VisualScenario, identifier: string,
  state: { inputsFilled: boolean; backgroundBanner: ScreenshotBounds | undefined }): Promise<void> {
  await prepareScenarioStep(device, identifier);
  if (isSignInPrompt(scenario)) state.backgroundBanner = await bannerBounds(device);
  if (identifier === 'advanced-options-button') {
    await fillScenarioInputs(device, scenario);
    state.inputsFilled = true;
  }
  await clickScenarioStep(device, scenario, identifier);
}

/** 设置页尾入口必须完整滚到手势条上方。
 * @param device - 原生设备。
 * @param identifier - 当前按钮。
 */
async function prepareScenarioStep(device: AndroidDevice, identifier: string): Promise<void> {
  if (!['share-app', 'official-site', 'about-laiwan'].includes(identifier)) return;
  await reveal(device, { res: 'about-laiwan' }, true);
  await scrollToEnd(device, { res: 'settings-list' }, { res: 'about-laiwan' });
}

/** 只有这两个 Dialog 会隐藏背景无障碍节点。
 * @param scenario - 共享场景。
 */
function isSignInPrompt(scenario: VisualScenario): boolean {
  return ['search_sign_in_prompt', 'guest_game_sign_in_prompt'].includes(scenario.pageLabel);
}

/** 弹窗打开前记录真实横幅边界。
 * @param device - 原生设备。
 */
async function bannerBounds(device: AndroidDevice): Promise<ScreenshotBounds | undefined> {
  return (await device.info({ res: 'slot-banner' }).catch(() => undefined))?.bounds;
}

/** 私人房入口在原生大厅；其余入口按职责分发。
 * @param device - 原生设备。
 * @param scenario - 共享场景。
 * @param identifier - 当前按钮。
 */
async function clickScenarioStep(device: AndroidDevice, scenario: VisualScenario, identifier: string): Promise<void> {
  if (['personal-house-create', 'personal-house-join'].includes(identifier)) {
    await openPersonalHouse(device, scenario, identifier);
    return;
  }
  await clickStandardStep(device, identifier);
}

/** 已打开的选玩法不重复点击底下按钮；登录使用原生设置入口。
 * @param device - 原生设备。
 * @param identifier - 当前按钮。
 */
async function clickStandardStep(device: AndroidDevice, identifier: string): Promise<void> {
  if (await pickerAlreadyOpen(device, identifier)) return;
  if (identifier === 'hall-sign-in-button') {
    await tap(device, 'settings-tab');
    await tap(device, 'sign-in-button');
    await device.wait({ res: 'username-or-email-sign-in-button' });
    return;
  }
  await tap(device, identifier);
}

/** 仅跳过已打开抽屉时的建房按钮。
 * @param device - 原生设备。
 * @param identifier - 当前按钮。
 */
async function pickerAlreadyOpen(device: AndroidDevice, identifier: string): Promise<boolean> {
  return identifier === 'create-game-button' && await exists(device, { res: 'select-game-category-text' });
}

/** 保留私人房创建、加入与选玩法抽屉的不同就绪条件。
 * @param device - 原生设备。
 * @param scenario - 共享场景。
 * @param identifier - 大厅按钮。
 */
async function openPersonalHouse(device: AndroidDevice, scenario: VisualScenario, identifier: string): Promise<void> {
  await tap(device, 'hall-tab');
  await tap(device, identifier);
  if (identifier === 'personal-house-create') {
    await reveal(device, { res: 'select-game-category-text' });
    if (!scenario.navClickTestIds.includes('create-game-button')) await closeGamePicker(device);
  } else await reveal(device, { res: 'copy-house-number-button' });
}

/** 保留输入、页面转场与加载完成的独立等待。
 * @param device - 原生设备。
 * @param scenario - 共享场景。
 */
async function finishScenario(device: AndroidDevice, scenario: VisualScenario): Promise<void> {
  await reveal(device, nativeSelector(scenario.visualReadySelector));
  await finishScenarioScroll(device, scenario);
  await waitScenarioReady(device, scenario);
  await waitAbsent(device, { res: 'alert-message-text' });
  await dismissKeyboard(device);
}

/** 对大厅及高级建房区域执行原有的到底滚动。
 * @param device - 原生设备。
 * @param scenario - 共享场景。
 */
async function finishScenarioScroll(device: AndroidDevice, scenario: VisualScenario): Promise<void> {
  if (scenario.pageLabel === 'hall') await scrollToEnd(device, { res: 'hall-content-list' }, { res: 'hall-sign-in-button' });
  if (scenario.navClickTestIds.includes('advanced-options-button')) {
    await scrollToEnd(device, { scrollable: true, clazz: 'android.widget.ScrollView' }, { res: 'create-room-tips-text' });
  }
}

/** 顺序等待消失条件、就绪文字与加载指示器。
 * @param device - 原生设备。
 * @param scenario - 共享场景。
 */
async function waitScenarioReady(device: AndroidDevice, scenario: VisualScenario): Promise<void> {
  if (scenario.visualGoneSelector) await waitAbsent(device, nativeSelector(scenario.visualGoneSelector));
  if (scenario.readyText) await device.wait({ text: scenario.readyText });
  await waitScenarioLoading(device, scenario);
}

/** 场景要求时才等待进度条消失。
 * @param device - 原生设备。
 * @param scenario - 共享场景。
 */
async function waitScenarioLoading(device: AndroidDevice, scenario: VisualScenario): Promise<void> {
  if (scenario.waitForLoading) await waitAbsent(device, { clazz: 'android.widget.ProgressBar' });
}
