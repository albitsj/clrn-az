import { expect, test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb, launchApplication, waitForHall } from '../device';
import { withAndroidProxy } from '../proxy';
import { signIn, navigateScenario } from '../navigation';
import { androidScenarios } from '../scenarios';
import { captureNativeTransition } from '../animation-transition';
import { verifyLoopAnimation } from '../loop-animation';
import { captureMovingKeyframes } from '../loop-keyframes';
import { waitAbsent } from '../native-state';
import { gameReady } from '../game-controls';

test('all three native slot reels and reward types animate from real spin responses', async ({}, testInfo) => {
  test.skip(!['all', 'social'].includes(process.env.ANDROID_GROUP || 'all')
    || (process.env.ANDROID_LOCALE || 'en') !== 'en', '老虎机动画只在英文社交任务采集一次');
  test.setTimeout(420_000);
  await withAndroidProxy(async proxy => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      await waitForHall(device);
      await signIn(device);
      const scenario = androidScenarios('en', 'social').find(item => item.pageLabel === 'signed_in_hall');
      expect(scenario).toBeDefined();
      await navigateScenario(device, scenario!);
      const banner = await device.info({ res: 'slot-banner' });
      // 发布版会自动旋转横幅里的三个小滚轮；与主老虎机分别验证真实屏幕变化。
      await verifyLoopAnimation(device, 'hall-slot-banner', testInfo,
        [{ x: 380, y: 360, width: 256, height: 67 }], [], { timeoutMs: 8_000 });
      await captureMovingKeyframes(device, 'hall-slot-banner', testInfo,
        [{ x: 380, y: 360, width: 256, height: 67 }], 32, undefined, 5);
      /** 从登录大厅的真实横幅打开老虎机窗口。 */
      const pressBanner = () => adb('shell', 'input', 'tap',
        String(Math.round(banner.bounds.x + banner.bounds.width / 2)),
        String(Math.round(banner.bounds.y + banner.bounds.height / 2)));
      await captureNativeTransition(device, 'slot-popup-enter', testInfo,
        { x: 0, y: 500, width: 720, height: 680 }, pressBanner, [], [], 0, 'launchFrames');
      await device.wait({ res: 'slot-machine-view' });
      const reels = [
        { x: 143, y: 420, width: 137, height: 362 },
        { x: 287, y: 420, width: 137, height: 362 },
        { x: 431, y: 420, width: 137, height: 362 },
      ];
      for (const [currency, reward] of [
        ['coin', 'prize_coin_text_animation_text'],
        ['currency_diamond', 'prize_diamond_text_animation_text'],
        ['energy', 'prize_energy_text_animation_text'],
      ] as const) {
        await proxy.command('android/slot', { currency });
        const button = await device.info({ res: 'spin-button' });
        /** 点击正式老虎机的旋转按钮，网络夹具只固定奖励响应。 */
        const pressSpin = () => adb('shell', 'input', 'tap',
          String(Math.round(button.bounds.x + button.bounds.width / 2)),
          String(Math.round(button.bounds.y + button.bounds.height / 2)));
        await captureNativeTransition(device, `slot-${currency}-reels`, testInfo,
          { x: 124, y: 420, width: 469, height: 362 }, pressSpin, [], reels, 1500);
        const prize = await device.info({ res: reward });
        expect(Number(prize.text), `${currency} 应显示真实奖励`).toBeGreaterThan(0);
      }
      const status = await proxy.command<{ spins: number }>('android/slot');
      expect(status.spins, '三种奖励必须分别由真实旋转 RPC 触发').toBe(3);
      const close = await gameReady(device, 'close-button');
      /** 正常关闭老虎机，采集面板退场。能量不足会自动关闭面板，无法再点击该按钮。 */
      const pressClose = () => adb('shell', 'input', 'tap',
        String(Math.round(close.bounds.x + close.bounds.width / 2)),
        String(Math.round(close.bounds.y + close.bounds.height / 2)));
      await captureNativeTransition(device, 'slot-popup-exit', testInfo,
        { x: 0, y: 500, width: 720, height: 680 }, pressClose, [], [], 0, 'launchFrames');
      await waitAbsent(device, { res: 'slot-machine-view' });
      const bannerAgain = await device.info({ res: 'slot-banner' });
      await adb('shell', 'input', 'tap',
        String(Math.round(bannerAgain.bounds.x + bannerAgain.bounds.width / 2)),
        String(Math.round(bannerAgain.bounds.y + bannerAgain.bounds.height / 2)));
      await device.wait({ res: 'slot-machine-view' });
      await proxy.command('android/slot', { currency: 'coin', noEnergy: true });
      const spin = await device.info({ res: 'spin-button' });
      /** 真实能量不足 RPC 触发老虎机窗口切换到专用提示。 */
      const pressEmptySpin = () => adb('shell', 'input', 'tap',
        String(Math.round(spin.bounds.x + spin.bounds.width / 2)),
        String(Math.round(spin.bounds.y + spin.bounds.height / 2)));
      const noEnergyRegion = { x: 80, y: 510, width: 560, height: 380 };
      await captureNativeTransition(device, 'slot-no-energy-enter', testInfo, noEnergyRegion, pressEmptySpin);
      const prompt = await device.info({ res: 'slot-no-energy-popup-container' });
      expect(prompt.bounds.width).toBeGreaterThan(0);
      const confirm = await device.info({ res: 'confirm-button' });
      /** 通过真实确认按钮关闭能量不足提示。 */
      const pressConfirm = () => adb('shell', 'input', 'tap',
        String(Math.round(confirm.bounds.x + confirm.bounds.width / 2)),
        String(Math.round(confirm.bounds.y + confirm.bounds.height / 2)));
      await captureNativeTransition(device, 'slot-no-energy-exit', testInfo, noEnergyRegion, pressConfirm);
      const final = await proxy.command<{ spins: number }>('android/slot');
      expect(final.spins, '能量不足由第四次旋转请求触发').toBe(4);
      await waitAbsent(device, { res: 'slot-machine-view' });
    } finally { await device?.close(); }
  }, false, false, true);
});
