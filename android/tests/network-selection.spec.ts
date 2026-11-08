import { englishGroup } from './support/selection';
import { test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { artifacts, launchApplication, waitForStagingNotice } from '../device';
import { dismissKeyboard } from '../keyboard';
import { signIn } from '../navigation';
import { withAndroidProxy } from '../proxy';
import { captureDeviceFailure, closeDevice } from './support/lifecycle';
import { waitForNetworkSelection, type Selection } from '../network-selection-check';

// 两个异常模式独立冷启动同一固定 APK；正常视觉和登录不启用它们。
test.describe('Android native network selection', () => {
  test.describe.configure({ retries: 0 });
  for (const scene of ['network-64-unavailable', 'network-without-64'] as const) {
    test(scene, async ({}, testInfo) => {
      test.skip(!englishGroup('guest'), '在英文游客任务验证原生客户端选线');
      await withAndroidProxy(async proxy => {
        let device: AndroidDevice | undefined;
        try {
          device = await launchApplication();
          await waitForStagingNotice(device);
          await device.fill({ res: 'staging-confirmation-input' }, 'CONFIRM');
          await dismissKeyboard(device);
          await device.tap({ res: 'confirm-button' });
          // 不点击初始化错误的 RETRY；要求本次初始化直接完成。
          await device.wait({ res: 'settings-tab' }, { timeout: 120_000 });
          await testInfo.attach('initialized-hall', { body: await device.screenshot(), contentType: 'image/png' });
          await signIn(device);
          await waitForNetworkSelection(
            /** 每次从本轮代理读取最新事件，不复用失败时的旧快照。 */
            () => proxy.command<Selection>('android/network-selection'), scene);
        } catch (error) {
          await captureDeviceFailure(device, testInfo);
          throw error;
        } finally {
          try {
            await testInfo.attach('network-selection', {
              body: JSON.stringify({ scene, ...await proxy.command<Selection>('android/network-selection') }),
              contentType: 'application/json',
            });
            await testInfo.attach('build-info', { path: `${artifacts}/build-info.json`, contentType: 'application/json' });
          } finally { await closeDevice(device); }
        }
      }, scene);
    });
  }
});
