import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { NetworkClient } from './client.ts';
import { businessRequest } from './staging.ts';

const userId = '11111111-2222-4333-8444-555555555555';

/** Two logical regional nodes backed by real local HTTP sockets, not synthetic fetch responses.
 * @param t - Server cleanup context.
 * @param handler - Actual business handler receiving the logical node.
 */
async function sockets(t, handler) {
  const server = createServer((req, res) => {
    const node = req.headers['x-test-node'];
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/node/v1/status') return res.end(JSON.stringify({ server_load: 'normal' }));
    if (req.url === '/public/v13/metadata/servers') return res.end(JSON.stringify({ ok: true,
      result: { servers: { 'first.test': '', 'second.test': '' } } }));
    handler(req, res, node);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const events = [];
  const client = new NetworkClient({ bootstrap: ['https://first.test'],
    /** Restrict logical nodes while the transport maps them to the loopback server.
     * @param origin - Logical origin.
     */
    allowOrigin: origin => ['https://first.test', 'https://second.test'].includes(origin),
    /** Preserve sanitized production events.
     * @param event - Network diagnostic.
     */
    diagnostic: event => events.push(event),
    totalTimeoutMs: 2_000,
    /** Use real fetch/Undici sockets with a test-only address mapping.
     * @param url - Logical node and path.
     * @param options - Unmodified client transport options.
     */
    fetch: (url, options) => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,
      { ...options, headers: { ...options.headers, 'X-Test-Node': new URL(url).host } }),
  });
  t.after(() => client.dispose());
  return { client, events };
}

test('real Node socket reset after observer enter committed recovers in the same call without creating or debiting', async t => {
  const members = new Set();
  let entries = 0;
  const calls = [];
  const { client, events } = await sockets(t, (req, res, node) => {
    calls.push({ method: req.method, path: req.url, node });
    assert.equal(req.url, `/v10/texas_holdem/room/${userId}/enter`);
    members.add(userId);
    entries++;
    if (node === 'first.test') req.socket.destroy();
    else res.end(JSON.stringify({ ok: true, result: { play_session_id: userId } }));
  });
  const response = await businessRequest(client, `/v10/texas_holdem/room/${userId}/enter`, 'PUT',
    { client_support: ['time_based_rules'] }, 'Bearer test-session');
  assert.equal(response.result.play_session_id, userId);
  assert.equal(entries, 2, 'entry notification may be emitted twice; the documented semantics permit it');
  assert.equal(members.size, 1);
  assert.deepEqual(calls.map(call => call.node), ['first.test', 'second.test']);
  assert.ok(events.some(event => event.event === 'failure' && event.kind === 'network'));
  assert.ok(events.some(event => event.event === 'success' && event.attempt === 2));
});

test('real response loss after DELETE executes never repeats room deletion or settlement', async t => {
  let deletions = 0;
  const { client } = await sockets(t, (req) => { deletions++; req.socket.destroy(); });
  await assert.rejects(businessRequest(client, `/v1/room/${userId}`, 'DELETE', undefined, 'Bearer test-session'),
    error => error.kind === 'network' && error.attempts === 1);
  assert.equal(deletions, 1);
});


test('get-or-create house and session login remain single-send after the server commits and drops the response', async t => {
  for (const [path, method, body] of [
    [`/v10/house/user/${userId}`, 'PUT', undefined],
    ['/public/v10/user/login/username/password', 'POST', { username: 'test-user', password: 'private-password' }],
  ]) {
    let writes = 0;
    const { client } = await sockets(t, req => { writes++; req.socket.destroy(); });
    await assert.rejects(businessRequest(client, path, method, body, 'Bearer test-session'),
      error => error.kind === 'network' && error.attempts === 1);
    assert.equal(writes, 1);
  }
});
