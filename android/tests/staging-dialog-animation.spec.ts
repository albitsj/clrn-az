import { expect, test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb, launchApplication } from '../device';
import { dismissKeyboard } from '../keyboard';
import { captureNativeTransition } from '../animation-transition';

test('staging notice fades out after the real confirmation', async ({}, testInfo) => {
  test.skip(!['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all')
    || (process.env.ANDROID_LOCALE || 'en') !== 'en', '测试版提示动画只在英文游客任务采集一次');
  test.setTimeout(240_000);
  let device: AndroidDevice | undefined;
  try {
    device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
    await device.wait({ res: 'staging-confirmation-input' });
    const dialog = await device.info({ res: 'staging-dialog' });
    expect(dialog.bounds.width).toBeGreaterThan(0);
    await device.fill({ res: 'staging-confirmation-input' }, 'CONFIRM');
    await dismissKeyboard(device);
    const confirm = await device.info({ res: 'confirm-button' });
    /** 在原生驱动采样期间按下真实确认按钮。 */
    const pressConfirm = () => adb('shell', 'input', 'tap',
      String(Math.round(confirm.bounds.x + confirm.bounds.width / 2)),
      String(Math.round(confirm.bounds.y + confirm.bounds.height / 2)));
    await captureNativeTransition(device, 'staging-notice-exit', testInfo, dialog.bounds, pressConfirm);
  } finally { await device?.close(); }
});
