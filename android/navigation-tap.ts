import type { AndroidDevice } from 'playwright';
import { expect } from '@playwright/test';
import { reveal } from './navigation-reveal';

/**
 * 点击真实控件；测试环境提示覆盖中央时使用控件内部仍可见的位置。
 * @param device - 专用模拟器连接。
 * @param identifier - 与 Web 共用的 testID。
 */
export async function tap(device: AndroidDevice, identifier: string): Promise<void> {
  console.log(`ANDROID > 点击 ${identifier}`);
  await reveal(device, { res: identifier });
  let previousBounds: unknown;
  await expect(async () => {
    const { bounds } = await device.info({ res: identifier });
    const previous = previousBounds;
    previousBounds = bounds;
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds, '点击前控件位置必须稳定').toEqual(previous);
  }).toPass({ timeout: 10_000, intervals: [200] });
  const { bounds } = await device.info({ res: identifier });
  const warning = await device.info({ res: 'switch-to-production-tip-container' }).catch(() => undefined);
  const agreement = await device.info({ res: 'user-agreement-title' }).catch(() => undefined);
  const overlapsWarning = [warning, agreement].some(overlay => overlay && bounds.y < overlay.bounds.y + overlay.bounds.height
    && bounds.y + bounds.height > overlay.bounds.y);
  if (identifier === 'username-or-email-sign-in-button' || overlapsWarning) {
    await device.input.tap({ x: bounds.x + bounds.width - 10, y: bounds.y + bounds.height / 2 });
  } else {
    await device.input.tap({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  }
}
