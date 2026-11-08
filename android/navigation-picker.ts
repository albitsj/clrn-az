import type { AndroidDevice } from 'playwright';
import { adb } from './device-command';
import { waitAbsent } from './native-state';

/**
 * 点击玩法弹层的真实遮罩关闭，避免系统 Back 同时弹出底下的房间详情页。
 * @param device - 专用模拟器连接。
 */
export async function closeGamePicker(device: AndroidDevice): Promise<void> {
  const { bounds } = await device.info({ res: 'select-game-category-text' });
  adb('shell', 'input', 'tap', '10', String(Math.max(30, Math.round(bounds.y - 100))));
  await waitAbsent(device, { res: 'select-game-category-text' });
}
