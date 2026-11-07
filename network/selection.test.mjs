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
    if (url.endsWith('/node/v1/status')) return Response.json({ server_load: 'normal' });
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
