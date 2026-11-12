import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { captureNativeTransition } from './animation-transition';

/** 不增加设备查询或等待，记录操作按钮采样和原回放请求的时间边界。
 * @param device - 当前模拟器。
 * @param info - 当前动画报告。
 * @param trigger - 原有 own-turn 回放，仍只调用一次。
 */
export async function captureOperationTransition(device: AndroidDevice, info: TestInfo, trigger: () => Promise<void>): Promise<void> {
  const events: { event: string; at: number }[] = [];
  /** 同步记录固定阶段名，不读取房间身份或请求正文。
   * @param event - 采集阶段。
   */
  const observe = (event: string) => { events.push({ event, at: Date.now() }); };
  /** 原请求的起止时间；失败仍由原采集路径处理。 */
  const send = async () => {
    observe('trigger-start');
    try { await trigger(); } finally { observe('trigger-complete'); }
  };
  try {
    await captureNativeTransition(device, 'texas-operation-buttons', info,
      { x: 100, y: 865, width: 500, height: 150 }, send, [], [], 400,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, observe);
  } finally {
    await info.attach('texas-operation-buttons-trigger-timing', {
      body: JSON.stringify(events), contentType: 'application/json',
    }).catch(() => undefined);
  }
}
