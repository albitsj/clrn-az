import assert from 'node:assert/strict';
import test from 'node:test';
import { send } from './transport.ts';

const url = 'https://node.test/v1/room/11111111-2222-4333-8444-555555555555';

test('cleanup HTTP 500 preserves status and emits only envelope flags even if logging fails', async t => {
  const log = t.mock.method(console, 'error', () => {});
  /** Return sensitive backend content that must never be logged. */
  const fetcher = async () => Response.json({ ok: false, error: { message: 'secret token' },
    error_description: 'private room and account' }, { status: 500 });
  await assert.rejects(send(fetcher, url, 'DELETE', {}, undefined, new AbortController().signal),
    { kind: 'server', status: 500 });
  assert.deepEqual(log.mock.calls[0].arguments, ['ROOM CLEANUP RESPONSE >', JSON.stringify({
    status: 500, bodyKind: 'json', jsonBody: true, ok: false, hasError: true, hasErrorDescription: true,
  })]);
  log.mock.mockImplementation(() => { throw new Error('logging unavailable'); });
  await assert.rejects(send(fetcher, url, 'DELETE', {}, undefined, new AbortController().signal),
    { kind: 'server', status: 500 });
});

test('malformed, oversized and stalled error bodies retain the original failure and release their stream', async t => {
  const log = t.mock.method(console, 'error', () => {});
  let cancelled = false;
  const stalled = new ReadableStream({
    /** Confirm that timed out diagnostics cancel their pending reader. */
    cancel() { cancelled = true; },
  });
  for (const [body, bodyKind] of [['private non-JSON response', 'non-json'], ['', 'empty'],
    ['x'.repeat(20_000), 'oversized'], [stalled, 'timeout'],
    [new ReadableStream({
      /** Simulate a private transport error without exposing its message.
       * @param controller - Response stream controller.
       */
      start(controller) { controller.error(new Error('secret')); },
    }), 'read-error'],
    [null, 'absent']]) {
    /** Supply one failed response without any retry. */
    const fetcher = async () => new Response(body, { status: 500 });
    await assert.rejects(send(fetcher, url, 'DELETE', {}, undefined, new AbortController().signal),
      { kind: 'server', status: 500 });
    const evidence = JSON.parse(log.mock.calls.at(-1).arguments[1]);
    assert.deepEqual(evidence, { status: 500, bodyKind, jsonBody: false, ok: null,
      hasError: false, hasErrorDescription: false });
  }
  assert.equal(cancelled, true);
  assert.equal(stalled.locked, false);
});

test('non-cleanup HTTP errors and successful cleanups do not collect response diagnostics', async t => {
  const log = t.mock.method(console, 'error', () => {});
  /** Supply an unrelated server error. */
  const failed = async () => Response.json({ ok: false }, { status: 500 });
  await assert.rejects(send(failed, url, 'GET', {}, undefined, new AbortController().signal), { status: 500 });
  /** Supply a normal successful cleanup response. */
  const success = async () => Response.json({ ok: true });
  assert.deepEqual(await send(success, url, 'DELETE', {}, undefined, new AbortController().signal), { ok: true });
  assert.equal(log.mock.callCount(), 0);
});
