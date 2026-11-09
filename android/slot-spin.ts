/** 保持滚轮采样条件，首败时固定响应时间与原生日志。 */
import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { captureNativeTransition } from './animation-transition';
import { preserveAnimationFailure } from './animation-diagnostics';
import type { ScreenshotBounds } from './screenshot';

/** 只在失败后查询代理计数，禁止在采样期间轮询或重触发旋转。
 * @param device - 当前模拟器。
 * @param proxy - 当前独占代理。
 * @param currency - 已配置的奖励种类。
 * @param info - 当前尝试的报告。
 * @param trigger - 原有真实点击。
 * @param reels - 原有三个独立滚轮区域。
 */
export async function captureSlotSpin(device: AndroidDevice, proxy: Mitmproxy, currency: string,
  info: TestInfo, trigger: () => unknown, reels: ScreenshotBounds[]): Promise<void> {
  const name = `slot-${currency}-reels`;
  const startedAt = Date.now();
  const events: { event: string; at: number }[] = [];
  try {
    await captureNativeTransition(device, name, info,
      { x: 124, y: 420, width: 469, height: 362 }, trigger, [], reels, 1500,
      'motionFrames', undefined, undefined, [], [], [], [], undefined,
      event => { events.push({ event, at: Date.now() }); });
  } catch (error) {
    await preserveAnimationFailure(name, startedAt, info).catch(() => undefined);
    await proxy.command<{ spins: number; lastSpinAt: number | null }>('android/slot').then(status =>
      info.attach(`${name}-response-timing`, { body: JSON.stringify({ events,
        spins: status.spins, lastSpinAt: status.lastSpinAt }), contentType: 'application/json' }))
      .catch(() => undefined);
    throw error;
  }
}
