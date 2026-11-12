import { selectionReply, testNode } from '../../../network/test-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { deletePrivateGameRoom } from './room';

const room = { roomId: '11111111-2222-4333-8444-555555555555',
  apiOrigin: 'https://unavailable-regional-proxy.invalid', authorization: 'Bearer test-session' };

test('收尾独立选线删除本轮房间，不复用 APK 的故障节点', async context => {
  const requests: { url: unknown; options: RequestInit | undefined }[] = [];
  context.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
    const selection = selectionReply(String(url), options);
    if (selection) return selection;
    requests.push({ url, options });
    return Response.json({ ok: true });
  });
  await deletePrivateGameRoom(room);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${testNode}/v1/room/${room.roomId}`);
  const options = requests[0].options;
  assert.ok(options);
  assert.equal(options.method, 'DELETE');
  assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Authorization: room.authorization });
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  await assert.rejects(deletePrivateGameRoom({ ...room, roomId: '../other' }), /有效 UUID/);
  assert.equal(requests.length, 1);
});

test('清理失败不会被当作测试成功', async context => {
  for (const response of [Response.json({ ok: false }), new Response('failed', { status: 503 })]) {
    context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => selectionReply(url, options) || response);
    await assert.rejects(deletePrivateGameRoom(room), /业务 API 请求失败/);
    context.mock.restoreAll();
  }
});
