/** 验证耗时动画采集后的真实取消及下一阶段回放边界，不改变应用操作时限。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { loadGameFlow } from './game-flow-fixture.mjs';

/** 仅替换设备、回放与截图边界，实际执行完整对手回合及结算流程。
 * @param options - 采集后回合是否已到期，以及真实取消或回放是否失败。
 */
function tableFixture({ expired, cancelWorks, restoreFailure }) {
  const state = { expired, choosing: true, restored: 0, raised: 0, captures: [] };
  const clicks = {
    /** 取消只改变选择态，不应伪造新的操作倒计时。 */
    'zhajinhua-cancel-challenge-choosing': () => { state.choosing = !cancelWorks; },
    /** 已到期的回合没有快捷加注入口。 */
    'zhajinhua-shortcut-raise-first': () => {
      assert.equal(state.expired, false, 'expired turn has no shortcut raise');
      assert.equal(state.choosing, false);
      state.raised++;
    },
  };
  const { captureOpponentAndSettlement } = loadGameFlow('./zhajinhua-gameplay-table.ts', {
    '@playwright/test': { expect },
    '../e2e/helpers/zhajinhua-scenes': { PLAYER_IDS: ['opponent'],
      /** 保留原来的真实牌桌场景载荷。
       * @param opponent - 是否轮到对手。
       * @param seen - 是否已经看牌。
       */ restoreTable: (opponent, seen) => ({ scene: 'table', opponent, seen }) },
    './animation-transition': {
      /** 外部采样结束后执行原回放触发，不改变本函数的业务顺序。
       * @param values - 原采样调用参数。
       */ captureNativeTransition: async (...values) => values[4]() },
    './device': {}, './game-panel-animation': {}, './game-pregame': {}, './loop-keyframes': {},
    './game-controls': {
      /** 真实取消的结果必须在回放前可观察。 */
      gameGone: async () => { assert.equal(state.choosing, false, 'challenge cancellation failed'); },
      /** 原有牌桌就绪边界。 */ gameReady: async () => ({}),
      /** 原有摊牌断言继续得到两位玩家。 */
      gameNodes: async () => [{ res: 'player_cards_container' }, { res: 'player_cards_container' }],
      /** 将实际入口操作转发给设备状态。
       * @param device - 专用设备。
       * @param name - 原有真实入口。
       */ gameTap: async (device, name) => clicks[name](),
    },
    './game-replay': {
      /** 回放仍通过当前房间的外部边界发送。 */
      gameReplaySender: () => async payload => {
        if (payload.scene === 'table' && !payload.opponent) restoreOwnTurn(state, payload, restoreFailure);
      },
    },
    './zhajinhua-gameplay-support': { /** 保留结算余额边界。 */ expectZhajinhuaBalance: async () => {} },
  });
  /** 使用真实流程记录三个最终截图状态。
   * @param animationInfo - 是否执行耗时原生动画采集。
   */
  const run = animationInfo => captureOpponentAndSettlement({ device: {}, roomId: 'same-room', animationInfo,
    /** 记录原有截图状态。
     * @param name - 截图状态名称。
     */ capture: async name => { state.captures.push(name); } });
  return { state, run };
}

/** 回放边界只恢复已取消选择态的同一回合配置。
 * @param state - 当前外部设备状态。
 * @param payload - 实际回放载荷。
 * @param failure - 外部回放边界的原始异常。
 */
function restoreOwnTurn(state, payload, failure) {
  assert.equal(state.choosing, false, 'restore must not hide failed cancellation');
  if (failure) throw failure;
  assert.equal(payload.seen, true);
  state.expired = false;
  state.restored++;
}

test('动画比较耗尽上一回合后，取消仍真实完成，再恢复同房间看牌状态继续加注', async () => {
  const { state, run } = tableFixture({ expired: true, cancelWorks: true });
  await run({});
  assert.equal(state.restored, 1);
  assert.equal(state.raised, 1);
  assert.deepEqual(state.captures, ['opponent_turn', 'showdown', 'settlement']);
});

test('取消失败不能靠恢复场景隐藏，也不能继续加注', async () => {
  const { state, run } = tableFixture({ expired: true, cancelWorks: false });
  await assert.rejects(run({}), /challenge cancellation failed/);
  assert.equal(state.restored, 0);
  assert.equal(state.raised, 0);
});

test('场景发送失败传播原始异常，不重放加注', async () => {
  const failure = new Error('replay failed');
  const { state, run } = tableFixture({ expired: true, cancelWorks: true, restoreFailure: failure });
  await assert.rejects(run({}), failure);
  assert.equal(state.raised, 0);
});

test('非动画阶段沿用原回合，不新增场景恢复', async () => {
  const { state, run } = tableFixture({ expired: false, cancelWorks: true });
  await run(undefined);
  assert.equal(state.restored, 0);
  assert.equal(state.raised, 1);
});
