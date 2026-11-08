import type { AndroidDevice, AndroidSelector } from 'playwright';
import type { VisualScenario } from '../visual/scenarioTypes';
import { adb } from './device';
import { dismissKeyboard } from './keyboard';
import { nativeSelector } from './scenarios';

/**
 * 用正常滚动和输入设置与 Web 相同的表单文字，不提交表单。
 * @param device - 专用模拟器连接。
 * @param scenario - 共用场景中的预填文字。
 */
export async function fillScenarioInputs(device: AndroidDevice, scenario: VisualScenario): Promise<void> {
  for (const rule of scenario.fixedTexts.filter(item => /input"\]$/.test(item.selector))) {
    const selector = nativeSelector(rule.selector);
    await revealInput(device, selector);
    // 原生 fill 的内部点击不会等待异步表单挂载，必须先确认输入框已出现。
    await device.wait(selector);
    await device.fill(selector, rule.text);
    await dismissKeyboard(device);
  }
}

/** 在原有九次滑动预算内寻找输入框。
 * @param device - 原生设备。
 * @param selector - 输入框。
 */
async function revealInput(device: AndroidDevice, selector: AndroidSelector): Promise<void> {
  for (let attempt = 0; attempt < 9; attempt++) {
    if (await inputRevealed(device, selector)) break;
  }
}

/** 已完整显示或无可滚动容器时停止寻找。
 * @param device - 原生设备。
 * @param selector - 输入框。
 */
async function inputRevealed(device: AndroidDevice, selector: AndroidSelector): Promise<boolean> {
  const node = await device.info(selector).catch(() => undefined);
  if (node) {
    if (inputBoundsVisible(node.bounds)) return true;
  }
  return scrollInput(device);
}

/** 保持输入区域的原有上下边界。
 * @param bounds - 输入框边界。
 */
function inputBoundsVisible(bounds: { y: number; height: number }): boolean {
  return bounds.height > 0 && bounds.y >= 176 && bounds.y + bounds.height <= 1232;
}

/** 执行原来的反向滑动；没有容器则结束寻找。
 * @param device - 原生设备。
 */
async function scrollInput(device: AndroidDevice): Promise<boolean> {
  const scrollable = await device.info({ scrollable: true }).catch(() => undefined);
  if (!scrollable) return true;
  const { x, y, width, height } = scrollable.bounds;
  const horizontal = String(Math.round(x + Math.min(8, width * 0.02)));
  adb('shell', 'input', 'swipe', horizontal, String(Math.round(y + height * 0.2)),
    horizontal, String(Math.round(y + height * 0.85)), '600');
  return false;
}
