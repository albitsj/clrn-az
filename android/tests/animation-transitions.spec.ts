import { expect, test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb, launchApplication, waitForHall } from '../device';
import { captureNativeTransition } from '../animation-transition';

test('guest search confirmation animates into and out of the Android screen', async ({}, testInfo) => {
  test.skip(!['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all')
    || (process.env.ANDROID_LOCALE || 'en') !== 'en', '短时动画只在英文游客任务采集一次');
  test.setTimeout(300_000);
  let device: AndroidDevice | undefined;
  try {
    device = await launchApplication({ gameDriver: true });
    await waitForHall(device);
    const entrance = await device.info({ res: 'hall-search-button' });
    /** 使用独立 ADB 连接触发按钮，使原生驱动同时采样屏幕。 */
    const pressSearch = () => adb('shell', 'input', 'tap',
      String(Math.round(entrance.bounds.x + entrance.bounds.width / 2)),
      String(Math.round(entrance.bounds.y + entrance.bounds.height / 2)));
    const region = { x: 58, y: 495, width: 604, height: 345 };
    await captureNativeTransition(device, 'search-confirmation-enter', testInfo, region, pressSearch);
    const cancel = await device.info({ res: 'cancel-button' });
    expect(cancel.bounds.width).toBeGreaterThan(0);
    /** 点击真实取消按钮，不直接卸载弹窗。 */
    const pressCancel = () => adb('shell', 'input', 'tap',
      String(Math.round(cancel.bounds.x + cancel.bounds.width / 2)),
      String(Math.round(cancel.bounds.y + cancel.bounds.height / 2)));
    await captureNativeTransition(device, 'search-confirmation-exit', testInfo, region, pressCancel);
  } finally { await device?.close(); }
});
