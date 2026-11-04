/** 在独立应用会话中采集有牌局的俱乐部页面，避免资料留在空态场景。 */
import { test } from '@playwright/test';
import { androidScenarios } from '../scenarios';
import { launchApplication, waitForHall, compareScreenshot } from '../device';
import { selectLanguage, signIn, navigateScenario } from '../navigation';
import { screenshotMasks } from '../screenshot';
import { withAndroidProxy } from '../proxy';

const locale = process.env.ANDROID_LOCALE || 'en';
const group = process.env.ANDROID_GROUP || 'all';
if (group === 'all' || group === 'social') {
  const scenario = androidScenarios(locale, group)
    .find(item => item.pageLabel === 'signed_in_club_rooms_populated');
  if (!scenario) throw new Error('缺少俱乐部有牌局的原生场景');

  test(`${locale} / ${scenario.group} / ${scenario.pageLabel}`, async ({}, testInfo) => {
    await withAndroidProxy(async proxy => {
      const device = await launchApplication();
      try {
        await waitForHall(device);
        await selectLanguage(device, locale);
        await proxy.command('native/club-rooms', { active: true });
        await signIn(device);
        const backgroundBanner = await navigateScenario(device, scenario);
        const masks = await screenshotMasks(device, scenario, backgroundBanner);
        await compareScreenshot(device, `${locale}-signed-in-club-rooms-populated`, testInfo, masks);
        const status = await proxy.command<{ requests: Record<string, number> }>('native/club-rooms');
        for (const path of ['/v10/club', '/v10/clubs', '/v2/building/rooms']) {
          if (!(status.requests[path] > 0)) throw new Error(`有数据牌局场景未经过 mitmproxy：${path}`);
        }
      } finally {
        await device.close();
      }
    });
  });
}
