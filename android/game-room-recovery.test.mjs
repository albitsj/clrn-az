/** 建房响应丢失后的安全清理必须复用严格检查，且不把失败变成通过。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

for (const cleanupFails of [false, true]) {
  test(`建房等待失败保留原错，恢复失败=${cleanupFails}`, async () => {
    const failure = new Error('真实建房接口未返回会话');
    const account = { username: process.env.VISUAL_USERNAME, userId: 'current-user', authorization: 'private-token' };
    const calls = [];
    const { createGameRoom } = loadGameFlow('./game-room.ts', {
      '@playwright/test': { /** 保留建房等待失败。 */ expect: () => ({
        /** 模拟原建房会话等待到期，不缩短生产等待预算。 */
        toPass: async () => { throw failure; },
      }) },
      '../visual/cases/_shared/room': { /** 不访问真实钱包。 */ ensureRoomBalance: async () => {} },
      '../visual/cases/texas-holdem/room': {},
      '../scripts/prepare-test-account-rooms.mjs': {
        /** 边界替身；真实归属、空闲和回读验证由既有房间清理测试覆盖。
         * @param session - 本轮已验证的账号会话。
         */
        prepareTestAccountRooms: async session => {
          assert.equal(session, account);
          calls.push('recover');
          if (cleanupFails && calls.length === 2) throw new Error('cleanup unavailable');
        },
      },
      './game-controls': {}, './keyboard': { /** 不访问键盘。 */ dismissKeyboard: async () => {} },
      './navigation': { /** 不执行导航。 */ returnToTabs: async () => { assert.deepEqual(calls, ['recover']); }, /** 不查设备。 */ reveal: async () => {}, /** 不执行点击。 */ tap: async () => {} },
    });
    await assert.rejects(createGameRoom({ /** 不查询设备。 */ wait: async () => {}, /** 不填写表单。 */ fill: async () => {} },
      { /** 只提供本轮登录会话。 */ command: async () => ({ account, room: null }) }, 'texas-holdem',
      () => { throw new Error('未取得新房间响应不得登记'); }), error => error === failure);
    assert.deepEqual(calls, ['recover', 'recover']);
  });
}
