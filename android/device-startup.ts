import type { AndroidDevice } from 'playwright';
import { dismissKeyboard } from './keyboard';

/**
 * 等待真实测试环境确认框；只清除已确认会遮挡应用的系统进程无响应弹窗。
 * @param device - 专用模拟器连接。
 */
export async function waitForStagingNotice(device: AndroidDevice): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await device.wait({ res: 'staging-confirmation-input' }, { timeout: 30_000 }); return; }
    catch (error) {
      await handleStagingTimeout(device, error, attempt);
    }
  }
}

/**
 * 完整通过测试环境确认，再等待正常初始化完成；不取消任何初始化错误。
 * @param device - 专用模拟器连接。
 */
export async function waitForHall(device: AndroidDevice): Promise<void> {
  await waitForStagingNotice(device);
  await device.fill({ res: 'staging-confirmation-input' }, 'CONFIRM');
  await dismissKeyboard(device);
  await device.tap({ res: 'confirm-button' });
  await waitUntilHall(device, Date.now() + 120_000);
}

/** 在原有两分钟时限内等待大厅，只恢复状态接口的明确网络故障。
 * @param device - 原生设备。
 * @param deadline - 原有绝对截止时间。
 */
async function waitUntilHall(device: AndroidDevice, deadline: number): Promise<void> {
  let lastTimeout: unknown;
  while (Date.now() < deadline) {
    try {
      await device.wait({ res: 'settings-tab' }, { timeout: Math.min(5_000, deadline - Date.now()) });
      return;
    } catch (error) {
      requireTimeout(error);
      lastTimeout = error;
      await retryStagingStatus(device, deadline);
    }
  }
  throw new Error('测试环境确认后两分钟内未进入大厅。', { cause: lastTimeout });
}

/** 只关闭两个已确认的系统进程无响应弹窗，不增加原有重试次数。
 * @param device - 原生设备。
 * @param error - 原始等待错误。
 * @param attempt - 当前尝试次数。
 */
async function handleStagingTimeout(device: AndroidDevice, error: unknown, attempt: number): Promise<void> {
  const dialogTitle = await systemDialogTitle(device);
  if (attempt >= 2) throw error;
  if (!["Pixel Launcher isn't responding", "com.google.android.googlesdksetup isn't responding"].includes(dialogTitle)) return;
  console.log(`ANDROID > 关闭 ${dialogTitle} 系统进程无响应弹窗，重新等待应用启动`);
  await device.tap({ res: 'android:id/aerr_close' });
}

/** 读取弹窗标题，保持查询失败时视为空标题的语义。
 * @param device - 原生设备。
 */
async function systemDialogTitle(device: AndroidDevice): Promise<string> {
  return (await device.info({ res: 'android:id/alertTitle' }).catch(() => undefined))?.text || '';
}

/** 只操作当前 staging 状态接口的 RETRY 按钮。
 * @param device - 原生设备。
 * @param deadline - 等待大厅的截止时间。
 */
async function retryStagingStatus(device: AndroidDevice, deadline: number): Promise<void> {
  const message = await device.info({ res: 'android:id/message' }).catch(() => undefined);
  const retry = await device.info({ res: 'android:id/button1' }).catch(() => undefined);
  if (!statusRetryAvailable(nodeText(message), nodeText(retry))) return;
  if (Date.now() >= deadline) return;
  await device.tap({ res: 'android:id/button1' });
  console.log('ANDROID > 已点击 staging v1/status 的 RETRY，继续原有大厅等待');
}

/** 确认消息确实来自 staging 的 v1/status，而非其他初始化错误。
 * @param message - 错误消息。
 * @param button - 按钮文字。
 */
function statusRetryAvailable(message: string | undefined, button: string | undefined): boolean {
  if (!message) return false;
  return [message.includes('ServerType: staging'), message.includes('v1/status'), button === 'RETRY'].every(Boolean);
}

/** 取得可选控件的文字。
 * @param node - 查询结果。
 */
function nodeText(node: { text?: string } | undefined): string | undefined { return node?.text; }

/** 非等待超时必须立即传播，不进入状态接口恢复。
 * @param error - 原始等待错误。
 */
function requireTimeout(error: unknown): void {
  if (!/Timeout.*exceeded/i.test(String(error))) throw error;
}
