import { expect, test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { launchApplication, waitForHall } from '../device';
import { withAndroidProxy } from '../proxy';
import { signIn, tap } from '../navigation';
import { gameNodes } from '../game-controls';
import { captureLoopKeyframes } from '../loop-keyframes';
import { waitAbsent } from '../native-state';

test('every native club placeholder pulses while detail response is pending', async ({}, testInfo) => {
  test.skip(!['all', 'social'].includes(process.env.ANDROID_GROUP || 'all')
    || (process.env.ANDROID_LOCALE || 'en') !== 'en', '俱乐部骨架动画只在英文社交任务采集一次');
  test.setTimeout(420_000);
  await withAndroidProxy(async proxy => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      await waitForHall(device);
      await signIn(device);
      await expect.poll(async () => (await proxy.command<{ loaded: number }>('android/skeleton')).loaded,
        { timeout: 60_000 }).toBeGreaterThan(0);
      const initial = (await proxy.command<{ loaded: number }>('android/skeleton')).loaded;
      await proxy.command('android/skeleton', { hold: true });
      await tap(device, 'club-tab');
      await device.wait({ res: 'ClubItemPlaceholder_container' });
      const placeholders = (await gameNodes(device))
        .filter(node => node.res === 'ClubItemPlaceholder_container' && node.bounds.width > 0);
      expect(placeholders, '两个真实俱乐部 ID 都应绘出各自的骨架').toHaveLength(2);
      await waitAbsent(device, { text: 'There is a slight network issue, please retry.' });
      await captureLoopKeyframes(device, 'club-list-skeleton', testInfo,
        placeholders.map(node => node.bounds), 5);
      await proxy.command('android/skeleton', { hold: false });
      await expect.poll(async () => (await proxy.command<{ loaded: number }>('android/skeleton')).loaded,
        { timeout: 30_000 }).toBeGreaterThan(initial);
    } finally {
      await proxy.command('android/skeleton', { hold: false }).catch(() => {});
      await device?.close();
    }
  }, false, false, false, true);
});
