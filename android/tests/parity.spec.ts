import { test, locale } from '../fixtures';
import { androidScenarios } from '../scenarios';
import { navigateScenario, signIn } from '../navigation';
import { compareScreenshot } from '../device';
import { screenshotMasks } from '../screenshot';
import { verifyLoopAnimation } from '../loop-animation';

for (const scenario of androidScenarios(locale, process.env.ANDROID_GROUP)) {
  test(`${locale} / ${scenario.group} / ${scenario.pageLabel}`, async ({ application }, testInfo) => {
    testInfo.annotations.push({ type: 'web-scenario', description: scenario.label });
    if (scenario.signIn && !application.signedIn) {
      await signIn(application.device);
      application.signedIn = true;
    }
    const backgroundBanner = await navigateScenario(application.device, scenario);
    const name = `${locale}-${scenario.pageLabel.replaceAll('_', '-')}`;
    const masks = await screenshotMasks(application.device, scenario, backgroundBanner);
    if (scenario.pageLabel === 'signed_in_hall' && locale === 'en') {
      const banner = masks.find(mask => mask.reason.startsWith('拉霸横幅自动轮播'));
      if (!banner) throw new Error('登录大厅必须有可见的原生拉霸横幅');
      /** 保留横幅动画未经遮罩的原始像素。 */
      const captureBanner = () => application.device.screenshot();
      await verifyLoopAnimation(application.device, name, testInfo,
        [{ x: Math.floor(banner.x), y: Math.floor(banner.y),
          width: Math.ceil(banner.x + banner.width) - Math.floor(banner.x),
          height: Math.ceil(banner.y + banner.height) - Math.floor(banner.y) }], masks,
        { takeScreenshot: captureBanner, timeoutMs: 12_000 });
    }
    await compareScreenshot(application.device, name, testInfo, masks);
  });
}
