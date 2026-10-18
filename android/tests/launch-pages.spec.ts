import { expect, test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { PNG } from 'pngjs';
import { adb, applicationId, artifacts, compareScreenshot, launchApplication, waitForHall } from '../device';
import { captureFailure } from '../diagnostics';
import { selectLanguage } from '../navigation';
import { withAndroidProxy } from '../proxy';

const locale = process.env.ANDROID_LOCALE || 'en';

test(`${locale} launch_staging_notice full screen`, async ({}, testInfo) => {
  test.skip(!['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all'), '启动页面在游客任务按三种语言采集');
  test.setTimeout(300_000);
  await withAndroidProxy(async () => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication();
      await waitForHall(device);
      // 通过真实设置保存语言，再冷启动；不写内部存储或移除测试环境提示。
      await selectLanguage(device, locale);
      adb('shell', 'am', 'force-stop', applicationId);
      adb('shell', 'am', 'start', '-n', `${applicationId}/com.laiwan_react_native.MainActivity`);
      await device.wait({ res: 'staging-confirmation-input' }, { timeout: 120_000 });
      expect((await device.info({ res: 'staging-confirmation-input' })).text).toBe('');
      await device.wait({ res: 'confirm-button' });
      /** 保留整张真实屏幕；截图尺寸必须与正式 Android 基准一致。 */
      const fullScreen = async () => {
        const bytes = await device!.screenshot();
        const picture = PNG.sync.read(bytes);
        expect({ width: picture.width, height: picture.height }).toEqual({ width: 720, height: 1280 });
        return bytes;
      };
      await compareScreenshot(device, `${locale}-launch-staging-notice`, testInfo, [], undefined, fullScreen);
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally {
      await testInfo.attach('build-info', { path: `${artifacts}/build-info.json`, contentType: 'application/json' });
      await device?.close();
    }
  });
});
