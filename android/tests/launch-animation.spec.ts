import { test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { launchApplication } from '../device';
import { captureLaunchBranding } from '../launch-animation';

test('Android launch branding fades in before staging confirmation', async ({}, testInfo) => {
  test.skip(!['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all')
    || (process.env.ANDROID_LOCALE || 'en') !== 'en', '启动动画只在英文游客任务采集一次');
  test.setTimeout(180_000);
  let device: AndroidDevice | undefined;
  try {
    device = await launchApplication({ gameDriver: true, enableSystemAnimations: true, deferStart: true });
    await captureLaunchBranding(device, testInfo);
  } finally { await device?.close(); }
});
