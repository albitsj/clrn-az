import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

test('record failure diagnostics retain only fixed markers and numeric totals', async () => {
  const attachments = [];
  const { preserveRecordFailure } = loadGameFlow('./record-diagnostics.ts', {
    './animation-diagnostics': { /** Simulate unavailable rotated logs. */ preserveAnimationFailure: async () => { throw new Error('private path'); } },
    './game-controls': { /** Include private text that must never be serialized. */ gameNodes: async () => [
      { res: 'progress-hud-modal', text: 'private response' }, { res: 'private-user-id', text: 'private token' },
    ] },
  });
  await preserveRecordFailure({}, { /** Return counters whose keys must not leave the process. */ status: async () => ({
    recordRequests: { 'private-path': 2 }, faultRequests: { 'private-body': 1 },
  }) }, { /** Capture only the emitted attachment.
    * @param name - Fixed attachment label.
    * @param data - Sanitized diagnostic body.
    */ attach: async (name, data) => attachments.push([name, JSON.parse(data.body)]) }, 123);
  assert.deepEqual(attachments, [['records-failure-state', {
    visible: ['progress-hud-modal'], recordRequests: 2, faultRequests: 1,
  }]]);
});

for (const stage of ['tree', 'status', 'attach']) {
  test(`record diagnostic ${stage} failure cannot escape into the original test`, async () => {
    /** Simulate a diagnostic failure containing sensitive text. */
    const fail = async () => { throw new Error('private token'); };
    const { preserveRecordFailure } = loadGameFlow('./record-diagnostics.ts', {
      './animation-diagnostics': { preserveAnimationFailure: fail },
      './game-controls': { gameNodes: stage === 'tree' ? fail : async () => [] },
    });
    await preserveRecordFailure({}, { status: stage === 'status' ? fail : async () => ({ recordRequests: {}, faultRequests: {} }) },
      { attach: stage === 'attach' ? fail : async () => {} }, 123);
  });
}

test('navigation checkpoint logging cannot replace the original wait failure', async t => {
  const failure = new Error('original device wait');
  t.mock.method(console, 'log', () => { throw new Error('logging unavailable'); });
  const { reopenRecords } = loadGameFlow('./record-navigation.ts', {
    './native-state': {}, '@playwright/test': {}, './device': {}, './navigation': {},
  });
  let back = 0;
  await assert.rejects(reopenRecords({ input: { /** Preserve the existing single Back action. */ press: async () => { back++; } },
    /** Preserve the original timeout object. */ wait: async () => { throw failure; } }), error => error === failure);
  assert.equal(back, 1);
});
