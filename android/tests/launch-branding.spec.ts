import { expect, test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { PNG } from 'pngjs';
import { adb, applicationId, artifacts, compareScreenshot, launchApplication, waitForHall } from '../device';
import { captureFailure } from '../diagnostics';
import { selectLanguage } from '../navigation';
import { dismissKeyboard } from '../keyboard';
import { gameMarker, gameReady, gameScreenshot } from '../game-controls';
import { withAndroidProxy } from '../proxy';

const locale = process.env.ANDROID_LOCALE || 'en';

test(`${locale} launch_branding full screen while initialization waits`, async ({}, testInfo) => {
  test.skip(!['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all'), '启动页面在游客任务按三种语言采集');
  test.setTimeout(300_000);
  await withAndroidProxy(async proxy => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true });
      await waitForHall(device);
      await selectLanguage(device, locale);
      await proxy.command('android/launch-network', { hold: true });
      adb('shell', 'am', 'force-stop', applicationId);
      adb('shell', 'am', 'start', '-n', `${applicationId}/com.laiwan_react_native.MainActivity`);
      await device.wait({ res: 'staging-confirmation-input' }, { timeout: 120_000 });
      await device.fill({ res: 'staging-confirmation-input' }, 'CONFIRM');
      await dismissKeyboard(device);
      const { bounds } = await gameReady(device, 'confirm-button');
      // 预热健康检查自行超时后，真实确认会重新初始化，留出完整五秒采样窗口。
      // 不延长应用超时，也不把可见错误提示关闭后当作成功截图。
      await expect.poll(async () => {
        const network = await proxy.command<{ requested: number; lastRequestedAt: number }>('android/launch-network');
        expect(network.requested, '必须真正拦截启动健康检查').toBeGreaterThan(0);
        return Date.now() - network.lastRequestedAt;
      }, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(6000);
      adb('shell', 'input', 'tap', String(Math.round(bounds.x + bounds.width / 2)),
        String(Math.round(bounds.y + bounds.height / 2)));
      await expect.poll(() => gameMarker(device!, 'launch-screen-container'), { timeout: 4000 }).not.toBeNull();
      await expect.poll(() => gameMarker(device!, 'staging-dialog'), { timeout: 4000 }).toBeNull();
      /** 启动页可能仍在原生弹窗下，必须同时排除提示和系统错误按钮。 */
      const assertBranding = async () => {
        expect(await gameMarker(device!, 'launch-screen-container'), '必须仍是完整品牌启动页').not.toBeNull();
        expect(await gameMarker(device!, 'staging-dialog'), '测试环境提示必须已真实关闭').toBeNull();
        expect(await gameMarker(device!, 'android:id/button1'), '不能把原生错误弹窗当品牌页').toBeNull();
      };
      /** 验证当前仍是品牌启动页，再保存无裁切、无遮罩的完整真实屏幕。 */
      const fullScreen = async () => {
        await assertBranding();
        const bytes = await gameScreenshot(device!);
        await assertBranding();
        const picture = PNG.sync.read(bytes);
        expect({ width: picture.width, height: picture.height }).toEqual({ width: 720, height: 1280 });
        return bytes;
      };
      await compareScreenshot(device, `${locale}-launch-branding`, testInfo, [], undefined, fullScreen);
      await proxy.command('android/launch-network', { hold: false });
      await device.wait({ res: 'settings-tab' }, { timeout: 120_000 });
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally {
      await proxy.command('android/launch-network', { hold: false });
      await testInfo.attach('build-info', { path: `${artifacts}/build-info.json`, contentType: 'application/json' });
      await device?.close();
    }
  });
});
