import type { AndroidDevice } from 'playwright';
import { adb } from './device-command';
import { exists, waitAbsent } from './native-state';
import { tap } from './navigation-tap';
import { assertRetry } from './navigation-reveal';
import { closeGamePicker } from './navigation-picker';

/**
 * 返回主标签，避免前一个表单或弹层影响下一场景。
 * @param device - 专用模拟器连接。
 */
export async function returnToTabs(device: AndroidDevice): Promise<void> {
  for (let attempt = 0; attempt < 9; attempt++) {
    if (await tabsAttempt(device, attempt)) return;
  }
}

/** 先关闭覆盖标签栏的浮层，再检查标签或正常返回。
 * @param device - 原生设备。
 * @param attempt - 当前尝试次数。
 */
async function tabsAttempt(device: AndroidDevice, attempt: number): Promise<boolean> {
  await dismissPreviousTimeout(device);
  if (await dismissTabOverlay(device)) return false;
  return waitForTabs(device, attempt);
}

/** 场景间确认上一页的网络超时提示，恢复被原生 Dialog 隐藏的关闭入口。
 * @param device - 原生设备。
 */
async function dismissPreviousTimeout(device: AndroidDevice): Promise<void> {
  const message = { res: 'android:id/message', text: 'timeout' };
  if (!await exists(device, message)) return;
  const button = { res: 'android:id/button1', text: 'OK' };
  if (!await exists(device, button)) return;
  await device.tap(button);
  await waitAbsent(device, message);
}

/** 标签等待失败时只按原有预算返回一次。
 * @param device - 原生设备。
 * @param attempt - 当前尝试次数。
 */
async function waitForTabs(device: AndroidDevice, attempt: number): Promise<boolean> {
  try { await device.wait({ res: 'settings-tab' }, { timeout: 3000 }); return true; }
  catch (error) {
    assertRetry(attempt, error);
    await device.input.press('Back');
    return false;
  }
}

const tabOverlays: [string, (device: AndroidDevice) => Promise<void>][] = [
  ['stepDescription', dismissTabTutorial],
  ['slot-machine-view', closeSlot],
  ['confirm-pop-up-image-background', cancelConfirmation],
  ['select-game-category-text', closeGamePicker],
  ['base-create-room-screen', backFromCreateRoom],
];

/** 按既有优先级逐个检查，不点击遮罩下保留的标签。
 * @param device - 原生设备。
 */
async function dismissTabOverlay(device: AndroidDevice): Promise<boolean> {
  for (const [res, close] of tabOverlays) {
    if (await exists(device, { res })) { await close(device); return true; }
  }
  return false;
}

/** 按真实可见的引导按钮坐标点击；没有可见按钮时继续原有查询循环。
 * @param device - 原生设备。
 */
async function dismissTabTutorial(device: AndroidDevice): Promise<void> {
  const buttons = await Promise.all(['tooltip-finish-button', 'tooltip-next-button']
    .map(res => device.info({ res }).catch(() => undefined)));
  const button = buttons.find(visibleTutorialButton);
  if (!button) return;
  const { x, y, width, height } = button.bounds;
  adb('shell', 'input', 'tap', String(Math.round(x + width / 2)), String(Math.round(y + height / 2)));
}

/** 忽略空节点和无尺寸的历史按钮。
 * @param node - 引导按钮查询结果。
 */
function visibleTutorialButton(node: Awaited<ReturnType<AndroidDevice['info']>> | undefined): boolean {
  if (!node) return false;
  return node.bounds.width > 0 && node.bounds.height > 0;
}

/** 正常关闭拉霸。
 * @param device - 原生设备。
 */
async function closeSlot(device: AndroidDevice): Promise<void> {
  await tap(device, 'close-button');
  await waitAbsent(device, { res: 'slot-machine-view' });
}

/** 正常取消确认框。
 * @param device - 原生设备。
 */
async function cancelConfirmation(device: AndroidDevice): Promise<void> {
  await tap(device, 'cancel-button');
  await waitAbsent(device, { res: 'confirm-pop-up-image-background' });
}

/** 正常返回建房页面外，并等待卸载。
 * @param device - 原生设备。
 */
async function backFromCreateRoom(device: AndroidDevice): Promise<void> {
  await device.input.press('Back');
  await waitAbsent(device, { res: 'base-create-room-screen' });
}
