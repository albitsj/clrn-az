import { selectionReply, testNode } from '../network/test-fixture.mjs';
// 仅由分配器的子进程测试通过 --import 加载，不提供生产跳过余额准备的开关。
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const userId = '11111111-2222-4333-8444-555555555555';
let username;
/**
 * 替换子进程的网络边界，验证准备期间持有账号锁并按真实契约返回数据。
 * @param url - 准备逻辑发出的固定 staging 请求。
 * @param options - 请求方法、正文和认证头。
 */
globalThis.fetch = async (url, options) => {
  const selection = selectionReply(url, options);
  if (selection) return selection;
  const body = options.body === undefined ? undefined : JSON.parse(options.body);
  return accountReply(url, options, body);
};

/** Track the selected account before checking its lock.
 * @param url - Current business URL.
 * @param options - Request options.
 * @param body - Parsed payload.
 */
function accountReply(url, options, body) {
  const directory = dirname(process.env.GITHUB_ENV || process.env.CLRN_TEST_ACCOUNT_POOL);
  if (url.endsWith('/public/v10/user/login/username/password')) username = body.username;
  const lock = join(directory, 'locks', username.toLowerCase());
  assertAccountLock(lock);
  assert.equal(new URL(url).origin, fixtureOrigin(url));
  assert.equal(options.redirect, 'error');
  return fixtureReply(url, body, directory);
}

/** Check the CI export boundary or the local exclusive lock.
 * @param lock - Selected account lock.
 */
function assertAccountLock(lock) {
  if (process.env.GITHUB_ENV) {
    assert.equal(existsSync(process.env.GITHUB_ENV) ? readFileSync(process.env.GITHUB_ENV, 'utf8') : '', '',
      '余额核对完成前不能导出测试账号');
  } else {
    assert.ok(existsSync(lock), '余额准备必须持有该账号的锁');
  }
}

/** Return the configured rejection before any successful fixture.
 * @param url - Business URL.
 * @param body - Parsed payload.
 * @param directory - Fixture directory.
 */
function fixtureReply(url, body, directory) {
  const rejection = join(directory, 'reject-wallet');
  if (existsSync(rejection) && url.includes(readFileSync(rejection, 'utf8'))) {
    return new Response('private-token', { status: 401 });
  }
  return reply(url, body, directory);
}

/** Return business fixtures after the account-lock checks.
 * @param url - Current business URL.
 * @param body - Parsed request body.
 * @param directory - Current temporary account pool directory.
 */
function reply(url, body, directory) {
  const handlers = [
    ['/public/v10/user/login/username/password', loginReply],
    ['/set_balance/testing', balanceReply],
    [`/v10/house/user/${userId}`, houseReply],
    ['/v2/building/rooms', () => roomsReply(directory)],
  ];
  const entry = handlers.find(([suffix]) => url.endsWith(suffix));
  if (entry) return entry[1](body);
  assert.equal(new URL(url).pathname, `/v10/wallet/${userId}`);
  return Response.json({ ok: true, result: { currencies: [{ code: 'coin', balance: '10000' }] } });
}

/** Return the current account's real-contract login fixture. */
function loginReply() {
  return Response.json({ ok: true, result: { user_id: userId, username,
    api_token: { token_type: 'Bearer', access_token: 'test-session' } } });
}

/** Assert and return the fixed coin preparation response.
 * @param body - Management payload.
 */
function balanceReply(body) {
  assert.deepEqual(body, { currency_name: 'coin', balance: '10000' });
  return Response.json({ ok: true, result: { wallet_id: userId, ...body } });
}

/** Return the current account's house. */
function houseReply() {
  return Response.json({ ok: true, result: { house_id: userId, user_id: userId } });
}

/** Record successful preparation before returning an empty room list.
 * @param directory - Fixture directory.
 */
function roomsReply(directory) {
  appendFileSync(join(directory, 'prepared-accounts'), `${username}\n`);
  return Response.json({ ok: true, result: [] });
}

/** Distinguish fixed management writes from selected business requests.
 * @param url - Request URL.
 */
function fixtureOrigin(url) {
  return url.endsWith('/set_balance/testing') ? 'https://api.shafayouxi.org' : testNode;
}
