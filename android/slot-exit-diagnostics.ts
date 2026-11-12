import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { captureNativeTransition } from './animation-transition';
import { preserveAnimationFailure } from './animation-diagnostics';
import { preserveRenderStatistics } from './render-diagnostics';

/** 保持老虎机退场的原采样，仅在断言失败后保存现场。
 * @param device - 本次模拟器。
 * @param info - 本次尝试的报告。
 * @param pressClose - 原关闭按钮点击，只执行一次。
 */
export async function captureSlotExitWithDiagnostics(device: AndroidDevice, info: TestInfo,
  pressClose: () => unknown): Promise<void> {
  const name = 'slot-popup-exit';
  const startedAt = Date.now();
  const events: { event: string; at: number }[] = [];
  /** 只记录宿主阶段，不查询设备或改变采样窗口。
   * @param event - 固定阶段名。
   */
  const observe = (event: string) => { events.push({ event, at: Date.now() }); };
  /** 原点击失败时也保留完成时间，继续传播原异常。 */
  const trigger = () => {
    observe('trigger-start');
    try { return pressClose(); } finally { observe('trigger-complete'); }
  };
  try {
    await captureNativeTransition(device, name, info,
      { x: 0, y: 500, width: 720, height: 680 }, trigger, [], [], 0, 'videoFrames',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, observe);
  } catch (error) {
    await preserveAnimationFailure(name, startedAt, info).catch(() => undefined);
    await preserveRenderStatistics(name, info).catch(() => undefined);
    throw error;
  } finally {
    await info.attach(`${name}-input-trace`, {
      body: JSON.stringify({ startedAt, events }), contentType: 'application/json',
    }).catch(() => undefined);
  }
}
