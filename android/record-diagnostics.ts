import type { AndroidDevice } from 'playwright';
import type { TestInfo } from '@playwright/test';
import type { RecordProxy } from '../visual/cases/game-record/proxy';
import { preserveAnimationFailure } from './animation-diagnostics';
import { gameNodes } from './game-controls';

/** Preserve the failed attempt before later tests rotate its logs; never affect its result.
 * @param device - Failed attempt's device, before the driver closes.
 * @param proxy - Current isolated record proxy.
 * @param testInfo - Current attempt's report.
 * @param startedAt - Start of this attempt, in UTC milliseconds.
 */
export async function preserveRecordFailure(device: AndroidDevice, proxy: RecordProxy,
  testInfo: TestInfo, startedAt: number): Promise<void> {
  await preserveAnimationFailure('records', startedAt, testInfo).catch(() => undefined);
  try {
    const nodes = await gameNodes(device);
    const markers = ['progress-hud-modal', 'my-game-record-list', 'game-record',
      'navigation-bar-back-image', 'android:id/message', 'alert-message-text'];
    const visible = markers.filter(res => nodes.some(node => node.res === res));
    const status = await proxy.status();
    await testInfo.attach('records-failure-state', {
      body: JSON.stringify({ visible, recordRequests: total(status.recordRequests), faultRequests: total(status.faultRequests) }),
      contentType: 'application/json',
    });
  } catch { /* No error text, response contents or credentials enter this diagnostic. */ }
}

/** Count requests without retaining paths, fixture identifiers or response contents.
 * @param counts - Current proxy counters.
 */
function total(counts: Record<string, number>): number {
  return Object.values(counts).filter(value => Number.isSafeInteger(value) && value >= 0).reduce((sum, value) => sum + value, 0);
}
