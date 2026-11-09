import { test as base } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { artifacts, launchApplication, waitForHall } from './device';
import { withAndroidProxy } from './proxy';
import { captureFailure } from './diagnostics';
import { selectLanguage } from './navigation';

export const locale = process.env.ANDROID_LOCALE || 'en';
export const test = base.extend<{}, { isolatedPasswordSession: boolean; application: { device: AndroidDevice; signedIn: boolean } }>({
  // worker 选项参与会话分组，防止独立密码页继承前置输入页面的原生布局状态。
  isolatedPasswordSession: [false, { scope: 'worker', option: true }],
  application: [async ({ isolatedPasswordSession }, use, workerInfo) => {
    if (isolatedPasswordSession) console.log('ANDROID > 密码页使用独立冷启动会话');
    await withAndroidProxy(async () => {
      console.log('ANDROID > 安装 APK 并启动原生驱动');
      const device = await launchApplication();
      try {
        console.log('ANDROID > 等待正常初始化');
        await waitForHall(device);
        console.log('ANDROID > 切换应用语言');
        await selectLanguage(device, locale);
        await use({ device, signedIn: false });
      } catch (error) {
        await mkdir(workerInfo.project.outputDir, { recursive: true });
        await device.screenshot().then(body => writeFile(`${workerInfo.project.outputDir}/setup-${locale}-${workerInfo.workerIndex}.png`, body)).catch(() => undefined);
        throw error;
      } finally {
        await device.close();
      }
    });
  }, { scope: 'worker', timeout: 240_000 }],
});

test.afterEach(async ({ application }, testInfo) => {
  await testInfo.attach('build-info', { path: `${artifacts}/build-info.json`, contentType: 'application/json' });
  if (testInfo.status === testInfo.expectedStatus) return;
  await captureFailure(application.device, testInfo);
});
