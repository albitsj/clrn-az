/** 经专用模拟器代理验证俱乐部搜索命中结果，并比较独立原生截图基准。 */
import { expect, test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { compareScreenshot, launchApplication, waitForHall } from '../device';
import { dismissKeyboard } from '../keyboard';
import { selectLanguage, signIn, tap } from '../navigation';
import { withAndroidProxy } from '../proxy';

type ClubSearchStatus = { active: boolean; searchRequests: number; detailsRequests: number };

test('俱乐部搜索命中固定结果并显示原生卡片', async ({}, testInfo) => {
  test.skip(!['all', 'social'].includes(process.env.ANDROID_GROUP || 'all'), '仅在社交业务组执行');
  test.setTimeout(420_000);
  await withAndroidProxy(async proxy => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication();
      await waitForHall(device);
      await selectLanguage(device, process.env.ANDROID_LOCALE || 'en');
      await signIn(device);
      await tap(device, 'club-tab');
      await device.wait({ res: 'club-tab-screen' });
      await tap(device, 'show-more-button');
      await device.wait({ res: 'club-more-popup' });
      await tap(device, 'search-club-button');
      await device.wait({ res: 'club-search-input' });

      // 初始化时也可能读取俱乐部资料；只在搜索页就绪后激活定向响应。
      await proxy.command('android/club-search', { active: true });
      await device.fill({ res: 'club-search-input' }, 'VisualClubSearch');
      await device.input.press('Enter');
      await device.wait({ res: 'club-search-item-name', text: '搜索测试俱乐部' });
      await device.wait({ res: 'club-search-item-touchable' });
      const status = await proxy.command<ClubSearchStatus>('android/club-search');
      expect(status.active).toBe(true);
      expect(status.searchRequests, '原生界面应发出一次搜索请求').toBe(1);
      expect(status.detailsRequests, '原生界面应读取一次命中俱乐部资料').toBe(1);
      await dismissKeyboard(device);
      const locale = process.env.ANDROID_LOCALE || 'en';
      await compareScreenshot(device, `${locale}-signed-in-club-search-result`, testInfo);
    } finally {
      await device?.close();
    }
  });
});
