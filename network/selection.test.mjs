import assert from 'node:assert/strict';
import test from 'node:test';
import { NetworkClient } from './client.ts';

const first = 'https://first.test';
const second = 'https://second.test';
const third = 'https://third.test';
const request = { path: '/read', endpoint: '/read', method: 'GET', replay: 'safe' };

/** Client fixture with explicit transport and short test deadlines.
 * @param t - Cleanup context.
 * @param fetcher - Offline transport behavior.
 * @param overrides - Cache/deadline configuration.
 */
function clientFor(t, fetcher, overrides = {}) {
  const client = new NetworkClient({ bootstrap: [first],
    /** Restrict logical test node origins.
     * @param host - Candidate origin.
     */
    allowOrigin: host => [first, second, third].includes(host),
    fetch: fetcher, totalTimeoutMs: 200, probeTimeoutMs: 30, ...overrides });
  t.after(() => client.dispose());
  return client;
}

/** Actual metadata protocol used by the app.
 * @param hosts - Logical node origins.
 */
function metadata(hosts) {
  return Response.json({ ok: true, result: { servers: Object.fromEntries(hosts.map(host => [new URL(host).host, '127.0.0.1'])) } });
}

/** Return a normal response for a health probe.
 * @param url - Requested URL.
 */
function normalHealthResponse(url) {
  return url.endsWith('/node/v1/status') ? Response.json({ server_load: 'normal' }) : null;
}

for (const refreshFails of [false, true]) {
  for (const [replay, maxAttempts] of [['safe', 2], ['never', 2], ['safe', 1]]) {
    test(`cached list exhaustion with ${refreshFails ? 'failed' : 'unchanged'} metadata: ${replay}, limit ${maxAttempts}`, async t => {
      let discoveries = 0;
      const calls = [];
      const events = [];
      // The bootstrap (first) is healthy but absent from metadata; only the regional node (second) resets.
      const client = clientFor(t, async (url, options) => {
        if (url.endsWith('/node/v1/status')) return Response.json({ server_load: 'normal' });
        if (url.endsWith('/public/v13/metadata/servers')) {
          assert.equal(options.headers.Authorization, undefined);
          discoveries++;
          if (refreshFails && discoveries > 1) throw new Error('socket hang up');
          return metadata([second]);
        }
        calls.push(new URL(url).origin);
        assert.equal(options.headers.Authorization, 'Bearer test-session');
        if (url.startsWith(second)) throw new Error('read ECONNRESET');
        return Response.json({ ok: true, result: { balance: 60 } });
      }, { maxAttempts,
        /** Collect the final outcome and the original failure.
         * @param event - Sanitized network diagnostic.
         */
        diagnostic: event => events.push(event) });
      const pending = client.request({ ...request, replay, headers: { Authorization: 'Bearer test-session' } });
      if (replay === 'safe' && maxAttempts > 1) {
        assert.deepEqual(await pending, { ok: true, result: { balance: 60 } });
        assert.deepEqual(calls, [second, first]);
        assert.equal(discoveries, 2);
        assert.ok(events.some(event => event.event === 'success' && event.node === first && event.attempt === 2));
        assert.ok(events.some(event => event.event === 'switch' && event.node === second && event.attempt === 1));
      } else {
        await assert.rejects(pending, error => error.kind === 'network' && error.attempts === 1);
        assert.deepEqual(calls, [second]);
        assert.equal(discoveries, 1);
        assert.ok(!events.some(event => event.event === 'switch'));
      }
      assert.ok(events.some(event => event.event === 'failure' && event.node === second && event.kind === 'network'));
    });
  }
}

for (const healthy of [true, false]) {
  test(`bootstrap fallback checks expired health before sending: healthy=${healthy}`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    let bootstrapProbes = 0;
    const calls = [];
    const client = clientFor(t, async url => {
      if (url.endsWith('/node/v1/status')) {
        if (url.startsWith(first)) bootstrapProbes++;
        return Response.json({ server_load: bootstrapProbes > 1 && !healthy ? 'busy' : 'normal' });
      }
      if (url.endsWith('/public/v13/metadata/servers')) return metadata([second]);
      calls.push(new URL(url).origin);
      if (url.startsWith(second)) {
        t.mock.timers.tick(11);
        throw new Error('read ECONNRESET');
      }
      return Response.json({ ok: true, result: { balance: 60 } });
    }, { healthCacheMs: 10 });
    if (healthy) {
      assert.deepEqual(await client.request(request), { ok: true, result: { balance: 60 } });
      assert.deepEqual(calls, [second, first]);
    } else {
      await assert.rejects(client.request(request), error => error.kind === 'unavailable' && error.attempts === 1);
      assert.deepEqual(calls, [second]);
    }
    assert.equal(bootstrapProbes, 2);
  });
}

test('an omitted bootstrap that also fails is excluded for the rest of the business call', async t => {
  const calls = [];
  const client = clientFor(t, async url => {
    const health = normalHealthResponse(url);
    if (health) return health;
    if (url.endsWith('/public/v13/metadata/servers')) return metadata([second]);
    calls.push(new URL(url).origin);
    throw new Error('socket hang up');
  });
  await assert.rejects(client.request(request), error => error.kind === 'unavailable' && error.attempts === 2);
  assert.deepEqual(calls, [second, first]);
});

for (const stop of ['timeout', 'cancel', 'dispose']) {
  test(`${stop} during metadata refresh prevents bootstrap business replay and cleans the request`, async t => {
    let discoveries = 0;
    let active = 0;
    const calls = [];
    const controller = new AbortController();
    const client = clientFor(t, async (url, options) => {
      if (url.endsWith('/node/v1/status')) return Response.json({ server_load: 'normal' });
      if (url.endsWith('/public/v13/metadata/servers')) {
        if (++discoveries === 1) return metadata([second]);
        active++;
        if (stop === 'cancel') queueMicrotask(() => controller.abort());
        if (stop === 'dispose') queueMicrotask(() => client.dispose());
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
          active--;
          reject(options.signal.reason);
        }, { once: true }));
      }
      calls.push(new URL(url).origin);
      throw new Error('read ECONNRESET');
    }, { totalTimeoutMs: 40, probeTimeoutMs: 200 });
    const started = performance.now();
    await assert.rejects(client.request({ ...request, signal: controller.signal }),
      error => error.kind === (stop === 'timeout' ? 'timeout' : 'cancelled') && error.attempts === 1);
    assert.deepEqual(calls, [second]);
    assert.equal(active, 0);
    assert.ok(performance.now() - started < 500);
  });
}

test('first unavailable bootstrap is skipped and healthy nodes require normal server_load', async t => {
  const calls = [];
  const client = clientFor(t, async (url, options) => {
    calls.push(url);
    if (url.startsWith(first)) throw Object.assign(new Error(), { code: 'ECONNREFUSED' });
    if (url.endsWith('/node/v1/status')) return Response.json({ server_load: url.startsWith(second) ? 'busy' : 'normal' });
    if (url.endsWith('/public/v13/metadata/servers')) return metadata([first, second, third]);
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ ok: true, result: 'third' });
  }, { bootstrap: [first, second, third] });
  assert.equal((await client.request(request)).result, 'third');
  assert.ok(calls.includes(third + '/read'));
  assert.ok(!calls.includes(first + '/read'));
  assert.ok(!calls.includes(second + '/read'));
});

test('losing health requests are aborted and no more than three probes run together', async t => {
  let active = 0;
  let maximum = 0;
  let cancelled = 0;
  const client = clientFor(t, async (url, options) => {
    if (url.endsWith('/public/v13/metadata/servers')) return metadata([first, second, third]);
    if (!url.endsWith('/node/v1/status')) return Response.json({ ok: true, result: 1 });
    active++;
    maximum = Math.max(active, maximum);
    if (url.startsWith(first)) { active--; return Response.json({ server_load: 'normal' }); }
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
      active--; cancelled++; reject(options.signal.reason);
    }, { once: true }));
  }, { bootstrap: [first, second, third] });
  await client.request(request);
  assert.equal(active, 0);
  assert.ok(maximum <= 3);
  assert.ok(cancelled >= 2);
});

test('all health probes fail within the call deadline without sending a business request', async t => {
  let business = 0;
  const client = clientFor(t, async url => {
    if (url.endsWith('/node/v1/status')) return Response.json({ server_load: 'overloaded' });
    business++;
    throw new Error('unexpected');
  });
  await assert.rejects(client.request(request), error => error.kind === 'unavailable' && error.attempts === 0);
  assert.equal(business, 0);
});

test('metadata falls back to another entry without forwarding credentials', async t => {
  const origins = [];
  const client = clientFor(t, async (url, options) => {
    const health = normalHealthResponse(url);
    if (health) return health;
    if (url.endsWith('/public/v13/metadata/servers')) {
      assert.equal(options.headers.Authorization, undefined);
      origins.push(new URL(url).origin);
      if (url.startsWith(first)) throw new Error('socket hang up');
      return metadata([second]);
    }
    return Response.json({ ok: true, result: new URL(url).origin });
  }, { bootstrap: [first, second] });
  assert.equal((await client.request({ ...request, headers: { Authorization: 'Bearer secret' } })).result, second);
  assert.ok(origins.includes(second));
});

test('malicious/empty metadata never receives credentials; healthy bootstrap remains usable', async t => {
  for (const servers of [{ 'evil.test': '' }, {}, { 'first.test/path?token=secret': '' }]) {
    const client = clientFor(t, async url => {
      assert.ok(url.startsWith(first));
      if (url.endsWith('/node/v1/status')) return Response.json({ server_load: 'normal' });
      if (url.endsWith('/public/v13/metadata/servers')) return Response.json({ ok: true, result: { servers } });
      return Response.json({ ok: true, result: 1 });
    });
    assert.equal((await client.request(request)).result, 1);
  }
});

test('expired caches refresh remote nodes; business failure invalidates a cached healthy node', async t => {
  let metadataCalls = 0;
  const business = [];
  const client = clientFor(t, async url => {
    if (url.endsWith('/node/v1/status')) return Response.json({ server_load: 'normal' });
    if (url.endsWith('/public/v13/metadata/servers')) {
      metadataCalls++;
      return metadata(metadataCalls === 1 ? [first] : [second]);
    }
    business.push(new URL(url).origin);
    return Response.json({ ok: true, result: 1 });
  }, { cacheMs: 10, healthCacheMs: 5 });
  await client.request(request);
  await new Promise(resolve => setTimeout(resolve, 15));
  await client.request(request);
  assert.equal(metadataCalls, 2);
  assert.deepEqual(business, [first, second]);
});

test('concurrent calls have independent cancellation and do not retain credentials', async t => {
  const tokens = [];
  const abort = new AbortController();
  const client = clientFor(t, async (url, options) => {
    if (url.endsWith('/node/v1/status')) return Response.json({ server_load: 'normal' });
    if (url.endsWith('/public/v13/metadata/servers')) return metadata([first]);
    tokens.push(options.headers.Authorization);
    if (options.headers.Authorization === 'Bearer cancelled') {
      queueMicrotask(() => abort.abort());
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    return Response.json({ ok: true, result: 'active' });
  });
  const results = await Promise.allSettled([
    client.request({ ...request, headers: { Authorization: 'Bearer cancelled' }, signal: abort.signal }),
    client.request({ ...request, headers: { Authorization: 'Bearer active' } }),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.kind, 'cancelled');
  assert.equal(results[1].status, 'fulfilled');
  await client.request(request);
  assert.equal(tokens.at(-1), undefined);
});
