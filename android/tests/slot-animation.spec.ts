import { expect, test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb, launchApplication, waitForHall } from '../device';
import { withAndroidProxy } from '../proxy';
import { signIn, navigateScenario } from '../navigation';
import { androidScenarios } from '../scenarios';
import { captureNativeTransition } from '../animation-transition';

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
      const scenario = androidScenarios('en', 'social').find(item => item.pageLabel === 'signed_in_slot');
      expect(scenario).toBeDefined();
      await navigateScenario(device, scenario!);
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
          { x: 124, y: 420, width: 469, height: 362 }, pressSpin, [], reels);
        const prize = await device.info({ res: reward });
        expect(Number(prize.text), `${currency} 应显示真实奖励`).toBeGreaterThan(0);
      }
      const status = await proxy.command<{ spins: number }>('android/slot');
      expect(status.spins, '三种奖励必须分别由真实旋转 RPC 触发').toBe(3);
    } finally { await device?.close(); }
  }, false, false, true);
});
