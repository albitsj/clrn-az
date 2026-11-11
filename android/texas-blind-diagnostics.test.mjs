import assert from 'node:assert/strict';
import test from 'node:test';
import { expect } from '@playwright/test';
import { loadGameFlow } from './game-flow-fixture.mjs';

/** Execute the real flow with a single original poll read and an isolated report.
 * @param ready - Whether the original expected row is present.
 * @param failAttachment - Simulate an unavailable report writer.
 */
async function run(ready, failAttachment = false) {
  let reads = 0;
  const attachments = [];
  const { texasOptionalPreGame } = loadGameFlow('./texas-record-variants.ts', {
    '@playwright/test': { expect: {
      /** Preserve the original assertion while replacing only the polling scheduler.
       * @param read - Production state read.
       * @param options - Original polling deadline.
       */
      poll: (read, options) => ({
        /** Run the original boolean assertion on the one supplied device state.
         * @param expected - Original expected value.
         */
        toBe: async expected => {
          assert.deepEqual(options, { timeout: 30_000 });
          expect(await read()).toBe(expected);
        },
      }),
    } },
    './game-controls': {
      /** No additional readiness reads in this boundary fixture. */ gameReady: async () => {},
      /** Loading disappearance has already completed before the original poll. */ gameGone: async () => {},
      /** Record no extra input in the fixture. */ gameTap: async () => {},
      /** Return no account or room text, only the original poll's visible markers. */
      gameNodes: async () => {
        reads++;
        return [{ res: 'raise-blind-detail' }, { res: 'raise-blind-loading' },
          { text: ready ? '1/2' : 'private-sensitive-text' }];
      },
    },
    './texas-support': {}, './game-pregame': {},
  });
  const result = texasOptionalPreGame({ device: {}, /** Screenshot callback is outside the readiness assertion. */ capture: async () => {}, diagnosticsInfo: {
    /** Simulate report I/O without changing the flow's result.
     * @param name - Attachment label.
     * @param data - Sanitized diagnostic data.
     */
    attach: async (name, data) => {
      attachments.push({ name, data });
      if (failAttachment) throw new Error('attachment unavailable');
    },
  } });
  if (ready) await result;
  else await assert.rejects(result, /Expected: true/);
  assert.equal(reads, 1);
  assert.equal(attachments[0].name, 'raise-blind-readiness');
  const [sample] = JSON.parse(attachments[0].data.body);
  assert.deepEqual({ ...sample, at: 0 }, { at: 0, detail: true, loading: true, hasExpectedRow: ready });
  assert.ok(!attachments[0].data.body.includes('private-sensitive-text'));
}

test('空升盲列表保留原始失败，并记录原有读取中的加载状态', () => run(false));
test('诊断失败不能覆盖升盲断言失败', () => run(false, true));
test('诊断失败不能把正常升盲用例变为失败', () => run(true, true));
