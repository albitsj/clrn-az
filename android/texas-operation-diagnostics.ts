import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { captureNativeTransition } from './animation-transition';

/** 保留操作按钮原有采样，记录回放与采样边界以调查首败全为起点的现场。
 * @param device - 当前原生设备。
 * @param info - 本次尝试的报告。
 * @param trigger - 原有本人回合回放，仍包含房间校验。
 */
export async function captureOperationTransition(device: AndroidDevice, info: TestInfo,
  trigger: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  const events: { event: string; at: number }[] = [];
  /** 仅记录固定阶段和宿主时间，不查询设备或记录回放数据。
   * @param event - 固定阶段名称。
   */
  const observe = (event: string) => { events.push({ event, at: Date.now() }); };
  try {
    await captureNativeTransition(device, 'texas-operation-buttons', info,
      { x: 100, y: 865, width: 500, height: 150 }, async () => {
        observe('own-turn-send-start');
        await trigger();
        observe('own-turn-send-complete');
      }, [], [], 400, 'motionFrames', undefined, undefined, [], [], [], [], undefined, observe);
  } finally {
    try {
      await info.attach('texas-operation-buttons-replay-trace', {
        body: JSON.stringify({ startedAt, events }), contentType: 'application/json',
      });
    } catch { /* 诊断失败不得替换原始采样或回放错误，也不得使成功用例失败。 */ }
  }
}
