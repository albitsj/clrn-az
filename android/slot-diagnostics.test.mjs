import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { withSlotDiagnostics } = createRequire(import.meta.url)('./slot-diagnostics.ts');

test('failed spin retains only the proxy counter and timeline, and rethrows the original error', async () => {
  const attachments = new Map();
  const events = [{ event: 'tap-start', at: 123 }];
  const original = new Error('第 1 个区域必须独立运动');
  await assert.rejects(withSlotDiagnostics('slot-currency_diamond-reels', events,
    async () => { throw original; }, async () => ({ spins: 2, authorization: 'private-token' }), {
      /** Retain report bytes at the attachment boundary.
       * @param name - Fixed diagnostic attachment name.
       * @param value - Attachment payload.
       */
      attach: async (name, value) => attachments.set(name, value.body),
    }), error => error === original);
  const trace = JSON.parse(attachments.get('slot-currency_diamond-reels-spin-trace'));
  assert.equal(trace.spins, 2);
  assert.deepEqual(trace.events, events);
  assert.ok(trace.capturedAt >= trace.startedAt);
  assert.equal([...attachments.values()].join('').includes('private-token'), false);
});

test('unavailable diagnostics preserve failure identity and successful capture adds no queries', async () => {
  const original = new Error('第 1 个区域必须独立运动');
  /** Reproduce an unavailable proxy without recording its untrusted exception. */
  const status = async () => { throw new Error('secret proxy response'); };
  const info = {
    /** Reproduce unavailable report storage. */
    attach: async () => { throw new Error('secret report failure'); },
  };
  await assert.rejects(withSlotDiagnostics('slot-currency_diamond-reels', [],
    async () => { throw original; }, status, info), error => error === original);
  let queries = 0;
  await withSlotDiagnostics('slot-currency_diamond-reels', [], async () => {},
    async () => { queries++; return { spins: 0 }; }, info);
  assert.equal(queries, 0, 'successful capture must not query proxy');
});
