import assert from 'node:assert/strict';
import test from 'node:test';
import { NetworkClient } from './client.ts';
import { classify } from './errors.ts';
import { businessRequest, setTestingBalance } from './staging.ts';

const first = 'https://first.test';
const second = 'https://second.test';
const request = { path: '/wallet/secret-user', endpoint: '/wallet/:userId', method: 'PUT', replay: 'safe',
  headers: { Authorization: 'Bearer private-token' }, body: { password: 'private-password' } };

/** Offline transport boundary: selection uses the actual health and metadata contracts.
 * @param t - Test cleanup context.
 * @param business - Per-attempt business behavior.
 * @param overrides - Additional client configuration.
 */
function fixture(t, business, overrides = {}) {
  const events = [];
  const calls = [];
  const signals = [];
  const client = new NetworkClient({ bootstrap: [first],
    /** Restrict the test to its two logical nodes.
     * @param value - Logical origin.
     */
    allowOrigin: value => [first, second].includes(value),
    totalTimeoutMs: 500, requestTimeoutMs: 100, probeTimeoutMs: 100,
    /** Collect sanitized production diagnostics.
     * @param event - Client event.
     */
    diagnostic: event => events.push(event),
    /** Supply the offline transport boundary.
     * @param url - Selected node URL.
     * @param options - Real client options.
     */
    fetch: async (url, options) => {
      signals.push(options.signal);
      if (url.endsWith('/node/v1/status')) {
        assert.equal(options.headers.Authorization, undefined);
        return Response.json({ server_load: 'normal' });
      }
      if (url.endsWith('/public/v13/metadata/servers')) {
        assert.equal(options.headers.Authorization, undefined);
        return Response.json({ ok: true, result: { servers: { 'first.test': '', 'second.test': '' } } });
      }
      calls.push({ url, ...options });
      return business(url, options, calls.length);
    }, ...overrides });
  t.after(() => client.dispose());
  return { client, calls, events, signals };
}

/** Wait for cancellation just as a hung transport would, without leaving timers behind.
 * @param signal - Transport cancellation signal.
 */
function untilAborted(signal) {
  signal.throwIfAborted();
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
}

test('Node reset, socket hang up and nested Undici causes are classified as recoverable', () => {
  for (const error of [new Error('read ECONNRESET'), new Error('socket hang up'),
    Object.assign(new Error(), { code: 'ECONNREFUSED' }),
    new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'UND_ERR_SOCKET' }) })]) {
    assert.equal(classify(error), 'network');
  }
  assert.equal(classify(Object.assign(new Error(), { code: 'ETIMEDOUT' })), 'timeout');
  assert.equal(classify(new SyntaxError()), 'invalid-response');
});

test('same call switches from reset node to real success envelope, preserving failure and attempt diagnostics', async t => {
  const { client, calls, events } = fixture(t, url => {
    if (url.startsWith(first)) throw new Error('read ECONNRESET private-token');
    return Response.json({ ok: true, result: { balance: 60 } });
  });
  assert.deepEqual(await client.request(request), { ok: true, result: { balance: 60 } });
  assert.deepEqual(calls.map(call => new URL(call.url).origin), [first, second]);
  assert.deepEqual(events.filter(event => event.event === 'failure').map(event => event.kind), ['network']);
  assert.equal(events.find(event => event.event === 'success').attempt, 2);
  assert.ok(events.some(event => event.event === 'switch'));
  assert.ok(!JSON.stringify(events).includes('private-'));
  assert.ok(!JSON.stringify(events).includes('secret-user'));
  await client.request(request);
  assert.equal(calls.at(-1).url, second + request.path);
  assert.ok(events.some(event => event.event === 'cache'));
});

test('all nodes fail once then exit without cycling, with a bounded error and cleaned probe signals', async t => {
  const { client, calls, signals } = fixture(t, () => { throw new Error('socket hang up'); });
  await assert.rejects(client.request(request), error => error.kind === 'unavailable' && error.attempts === 2);
  assert.equal(calls.length, 2);
  client.dispose();
  assert.ok(signals.every(signal => signal.aborted));
});

test('max attempts is enforced even when other nodes are available', async t => {
  const { client, calls } = fixture(t, () => { throw new Error('read ECONNRESET'); }, { maxAttempts: 1 });
  await assert.rejects(client.request(request), error => error.kind === 'network' && error.attempts === 1);
  assert.equal(calls.length, 1);
});

test('auth, business refusal, malformed JSON and HTTP errors never switch', async t => {
  for (const [reply, kind] of [
    [() => new Response('private-token', { status: 401 }), 'auth'],
    [() => new Response('private-token', { status: 403 }), 'auth'],
    [() => Response.json({ ok: false, error_message: 'private-token' }), 'business'],
    [() => Response.json({ ok: 'yes' }), 'invalid-response'],
    [() => new Response('not json'), 'invalid-response'],
    [() => new Response('missing', { status: 404 }), 'http'],
    [() => new Response('redirect', { status: 302 }), 'http'],
  ]) {
    const { client, calls, events } = fixture(t, reply);
    await assert.rejects(client.request(request), error => error.kind === kind && !error.message.includes('private-token'));
    assert.equal(calls.length, 1);
    assert.ok(!events.some(event => event.event === 'switch'));
  }
});

test('503 recovers for reviewed reads; non-replayable writes do not repeat after server execution', async t => {
  const safe = fixture(t, (_, __, count) => count === 1 ? new Response('', { status: 503 })
    : Response.json({ ok: true, result: 7 }));
  assert.equal((await safe.client.request(request)).result, 7);
  let creations = 0;
  let debits = 0;
  const unsafe = fixture(t, () => { creations++; debits++; throw new Error('socket hang up'); });
  await assert.rejects(unsafe.client.request({ ...request, method: 'POST', replay: 'never' }), error => error.kind === 'network');
  assert.equal(creations, 1);
  assert.equal(debits, 1);
  assert.equal(unsafe.calls.length, 1);
});

test('per-attempt timeout switches; total deadline includes selection and streaming body', async t => {
  const recovered = fixture(t, (_, options, count) => count === 1 ? untilAborted(options.signal)
    : Response.json({ ok: true, result: 'real' }), { requestTimeoutMs: 15 });
  assert.equal((await recovered.client.request(request)).result, 'real');
  const hung = fixture(t, (_, options) => untilAborted(options.signal), { totalTimeoutMs: 25 });
  const start = Date.now();
  await assert.rejects(hung.client.request(request), error => error.kind === 'timeout');
  assert.ok(Date.now() - start < 500);
  const streaming = fixture(t, (_, options) => new Response(new ReadableStream({
    /** Start a stalled response stream.
     * @param controller - Body controller.
     */
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"ok":'));
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
    },
  })), { totalTimeoutMs: 25 });
  await assert.rejects(streaming.client.request(request), error => error.kind === 'timeout');
});

test('caller cancellation and client disposal stop requests without switching', async t => {
  for (const dispose of [false, true]) {
    const controller = new AbortController();
    const { client, calls, events } = fixture(t, (_, options) => {
      queueMicrotask(() => dispose ? client.dispose() : controller.abort());
      return untilAborted(options.signal);
    });
    await assert.rejects(client.request({ ...request, signal: controller.signal }), error => error.kind === 'cancelled');
    assert.equal(calls.length, 1);
    assert.ok(!events.some(event => event.event === 'switch'));
  }
});

test('unknown writes and absolute URLs are rejected before sending credentials', async t => {
  const { client, calls } = fixture(t, () => { throw new Error('should not send'); });
  for (const path of ['https://evil.test', '//evil.test', '/v1/../wallet', '/wallet?token=secret']) {
    await assert.rejects(client.request({ ...request, path }), error => error.kind === 'configuration');
  }
  assert.throws(() => businessRequest(client, '/v3/pay_action/do', 'POST', {}), /configuration/);
  assert.equal(calls.length, 0);
});

test('testing token stays on fixed origin with one attempt after an ambiguous write', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    throw new Error('socket hang up private-token');
  });
  await assert.rejects(setTestingBalance('/public/v1/wallet/11111111-2222-4333-8444-555555555555/set_balance/testing',
    { balance: '60', currency_name: 'diamond' }, 'private-token'), error => error.kind === 'network' && !error.message.includes('private-token'));
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, 'https://api.shafayouxi.org');
  assert.equal(calls[0].headers['X-Testing-Api-Token'], 'private-token');
  assert.equal(calls[0].redirect, 'error');
});
