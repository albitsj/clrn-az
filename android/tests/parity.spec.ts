import { test, locale } from '../fixtures';
import { androidScenarios } from '../scenarios';
import { navigateScenario, signIn } from '../navigation';
import { compareScreenshot } from '../device';
import { compareResetPassword } from '../reset-password-diagnostics';
import { screenshotMasks } from '../screenshot';
import type { AndroidDevice } from 'playwright';
import type { VisualScenario } from '../../visual/scenarioTypes';
import type { TestInfo } from '@playwright/test';
import type { ScreenshotMask } from '../screenshot';
import { verifyLoopAnimation } from '../loop-animation';

for (const scenario of androidScenarios(locale, process.env.ANDROID_GROUP)
  .filter(item => item.pageLabel !== 'signed_in_club_rooms_populated')) {
  test(`${locale} / ${scenario.group} / ${scenario.pageLabel}`, async ({ application }, testInfo) => {
    testInfo.annotations.push({ type: 'web-scenario', description: scenario.label });
    await ensureSignedIn(application, scenario);
    const backgroundBanner = await navigateScenario(application.device, scenario);
    if (englishPage(scenario, 'signed_in_gift_card_exchange')) {
      await application.device.wait({ res: 'gift-card-input', text: 'Please input gift card code' });
    }
    const name = `${locale}-${scenario.pageLabel.replaceAll('_', '-')}`;
    const masks = await screenshotMasks(application.device, scenario, backgroundBanner);
    if (englishPage(scenario, 'signed_in_hall')) {
      await verifyHallBanner(application.device, name, testInfo, masks);
    }
    await comparePage(application.device, scenario, name, testInfo, masks);
  });
}

/** 登录状态与 worker fixture 一同保留，避免重复登录。
 * @param application - 当前原生会话。
 * @param scenario - 共享场景。
 */
async function ensureSignedIn(application: { device: AndroidDevice; signedIn: boolean }, scenario: VisualScenario): Promise<void> {
  if (scenario.signIn && !application.signedIn) {
    await signIn(application.device);
    application.signedIn = true;
  }
}

/** 登录大厅横幅须可见且真实播放，继续保留原始像素验证。
 * @param device - 当前设备。
 * @param name - 截图名称。
 * @param testInfo - 测试报告。
 * @param masks - 已验证的动态区域。
 */
async function verifyHallBanner(device: AndroidDevice, name: string, testInfo: TestInfo, masks: ScreenshotMask[]): Promise<void> {
  const banner = masks.find(mask => mask.reason.startsWith('拉霸横幅自动轮播'));
  if (!banner) throw new Error('登录大厅必须有可见的原生拉霸横幅');
  /** 保留横幅动画未经遮罩的原始像素。 */
  const captureBanner = () => device.screenshot();
  await verifyLoopAnimation(device, name, testInfo,
    [{ x: Math.floor(banner.x), y: Math.floor(banner.y),
      width: Math.ceil(banner.x + banner.width) - Math.floor(banner.x),
      height: Math.ceil(banner.y + banner.height) - Math.floor(banner.y) }], masks,
    { takeScreenshot: captureBanner, timeoutMs: 12_000 });
}

/** 只在既有英文页面执行其专用断言。
 * @param scenario - 当前场景。
 * @param page - 页面标识。
 */
function englishPage(scenario: VisualScenario, page: string): boolean { return scenario.pageLabel === page && locale === 'en'; }

/** 密码页补充原始采样诊断，其余页面沿用原比较器。
 * @param device - 当前设备。
 * @param scenario - 当前场景。
 * @param name - 截图名称。
 * @param info - 用例报告。
 * @param masks - 原场景遮罩。
 */
async function comparePage(device: AndroidDevice, scenario: VisualScenario, name: string,
  info: TestInfo, masks: ScreenshotMask[]): Promise<void> {
  if (englishPage(scenario, 'signed_in_reset_password')) await compareResetPassword(device, name, info, masks);
  else await compareScreenshot(device, name, info, masks);
}
