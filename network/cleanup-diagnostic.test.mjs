import assert from 'node:assert/strict';
import test from 'node:test';
import { send } from './transport.ts';

const url = 'https://node.test/v1/room/11111111-2222-4333-8444-555555555555';

test('room cleanup diagnostics redact causes and preserve the original fetch failure even when logging throws', async t => {
  const failure = new TypeError('secret token and response', { cause: Object.assign(new Error('private URL'), { code: 'ECONNRESET' }) });
  const log = t.mock.method(console, 'error', () => {});
  /** Reproduce a fetch rejection without serializing its cause. */
  const fetcher = async () => { throw failure; };
  await assert.rejects(send(fetcher, url, 'DELETE', {}, undefined, new AbortController().signal), error => error === failure);
  assert.deepEqual(log.mock.calls[0].arguments, ['ROOM CLEANUP TRANSPORT >',
    JSON.stringify({ phase: 'headers', kind: 'network', codes: ['ECONNRESET'] })]);
  log.mock.mockImplementation(() => { throw new Error('logging unavailable'); });
  await assert.rejects(send(fetcher, url, 'DELETE', {}, undefined, new AbortController().signal), error => error === failure);
});

test('room cleanup identifies body interruption and keeps ordinary requests free of cleanup diagnostics', async t => {
  const failure = Object.assign(new Error('sensitive response'), { code: 'UND_ERR_SOCKET' });
  const log = t.mock.method(console, 'error', () => {});
  /** Reproduce a stream failure after successful response headers. */
  const json = async () => { throw failure; };
  /** Return the response whose body fails. */
  const fetcher = async () => ({ ok: true, status: 200, json });
  await assert.rejects(send(fetcher, url, 'DELETE', {}, undefined, new AbortController().signal), { kind: 'network' });
  assert.deepEqual(log.mock.calls[0].arguments, ['ROOM CLEANUP TRANSPORT >',
    JSON.stringify({ phase: 'body', kind: 'network', codes: ['UND_ERR_SOCKET'] })]);
  log.mock.resetCalls();
  await assert.rejects(send(fetcher, url, 'GET', {}, undefined, new AbortController().signal), { kind: 'network' });
  assert.equal(log.mock.callCount(), 0);
});


test('cleanup diagnostic validates the same code value that it logs', async t => {
  const secret = 'private-token-that-must-not-be-logged';
  let reads = 0;
  const failure = new Error('private cause');
  Object.defineProperty(failure, 'code', {
    /** Reproduce an error property that changes between accesses. */
    get() { return ++reads <= 2 ? 'ECONNRESET' : secret; },
  });
  const log = t.mock.method(console, 'error', () => {});
  /** Preserve the original error while exercising mutable untrusted fields. */
  const fetcher = () => Promise.reject(failure);
  const observed = await send(fetcher, url, 'DELETE', {}, undefined, new AbortController().signal).catch(error => error);
  assert.equal(observed, failure);
  const serialized = log.mock.calls[0].arguments[1];
  assert.equal(serialized.includes(secret), false);
  assert.deepEqual(JSON.parse(serialized).codes, ['ECONNRESET']);
});
