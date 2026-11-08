import type { AndroidDevice } from 'playwright';
import type { TestInfo } from '@playwright/test';
import { waitForHall } from '../../device';
import { signIn } from '../../navigation';
import { captureFailure } from '../../diagnostics';

/** 启动已成功时保存原有失败诊断，启动失败时保留原始错误。
 * @param device - 可能尚未连接的设备。
 * @param info - 测试报告。
 */
export async function captureDeviceFailure(device: AndroidDevice | undefined, info: TestInfo): Promise<void> {
  if (device) await captureFailure(device, info);
}

/** 保持尚未连接时无需关闭的清理语义。
 * @param device - 可能尚未连接的设备。
 */
export async function closeDevice(device: AndroidDevice | undefined): Promise<void> { await device?.close(); }

/** 已连接的动画设备依次进入大厅和真实登录，失败仍由调用方原有 finally 清理。
 * @param device - 已连接的原生设备。
 */
export async function prepareSignedInAnimation(device: AndroidDevice): Promise<void> {
  await waitForHall(device);
  await signIn(device);
}
