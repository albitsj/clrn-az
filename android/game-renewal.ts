import type { AndroidDevice } from 'playwright';
import { expect, type TestInfo } from '@playwright/test';
import presentation from '../visual/fixtures/account-presentation.json';
import { gameTap as tap, gameReady, gameGone, gameNodes, gameConnected } from './game-controls';

/** 等待续费余额和价格加载完成。
 * @param device - 专用模拟器连接。
 */
export async function waitForRenewalData(device: AndroidDevice): Promise<void> {
  await expect.poll(async () => (await gameReady(device, 'renew-popup-remain-diamond')).text?.trim(),
    { timeout: 45_000 }).toBe(presentation.balance);
  await expect.poll(async () => Number((await gameReady(device, 'renew-popup-spend-diamond')).text?.trim()),
    { timeout: 45_000 }).toBeGreaterThan(0);
}

/** 等待续费业务数据；静态拼三张弹窗在两个初始值均未加载时允许重新打开。
 * @param device - 专用模拟器连接。
 * @param game - 当前玩法。
 * @param animationInfo - 动画采样期间不重新打开弹窗。
 */
export async function waitForRenewal(device: AndroidDevice, game: string, animationInfo?: TestInfo): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      // 关闭按钮先于异步余额和续费价格出现，初始的两个 0 不能作为业务就绪。
      await waitForRenewalData(device);
      break;
    } catch (error) {
      // Staging 钱包/报价 502 后不会自动重取；只对拼三张静态流程的未加载弹窗重开两次。
      if (game !== 'zhajinhua' || animationInfo || attempt >= 2
        || !String(error).includes('Timeout 45000ms exceeded while waiting on the predicate')) throw error;
      const nodes = await gameNodes(device);
      if (!['renew-popup-remain-diamond', 'renew-popup-spend-diamond'].every(marker =>
        nodes.some(node => node.res === marker && node.text?.trim() === '0'))) throw error;
      console.log(`ANDROID > 续费数据未加载，关闭并重新请求（${attempt + 1}/2）`);
      await tap(device, 'renew-popup-close-button');
      await gameGone(device, 'renew-popup-close-button');
      await gameConnected(device, 2_000);
      await tap(device, 'menu-button');
      await tap(device, 'drawer-menu-item-renew');
      await gameGone(device, 'drawer-menu-item-exit');
      await gameReady(device, 'renew-popup-close-button');
    }
  }
}

