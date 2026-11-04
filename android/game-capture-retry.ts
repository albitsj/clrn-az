import type { AndroidDevice } from 'playwright';
import { gameConnected, gameNodes, nodesConnecting } from './game-controls';

/** 仅重连遮罩打断稳定截图时重拍，最多两次，保持错误传播。
 * @param device - 原生设备。
 * @param capture - 共用状态截图。
 * @param state - 当前状态。
 */
export async function captureConnected(device: AndroidDevice, capture: (state: string) => Promise<void>, state: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await gameConnected(device, 2_000);
    try { await capture(state); return; }
    catch (error) { await assertCaptureRetry(device, attempt, error); }
  }
}

/** 只允许首轮且有真实重连提示的像素稳定错误重试。
 * @param device - 原生设备。
 * @param attempt - 当前尝试序号。
 * @param error - 原始截图错误。
 */
async function assertCaptureRetry(device: AndroidDevice, attempt: number, error: unknown): Promise<void> {
  const reconnecting = nodesConnecting(await gameNodes(device));
  if (attempt || !reconnecting) throw error;
  assertUnstableCapture(error);
}

/** 只有明确的像素稳定错误允许重连重采，保持终止分支不读取错误文字。
 * @param error - 原始截图错误。
 */
function assertUnstableCapture(error: unknown): void {
  if (!String(error).includes('页面像素必须保持稳定')) throw error;
}
