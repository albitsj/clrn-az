import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { loadGameFlow, gameFlowStep } from './game-flow-fixture.mjs';

/** 流程源码保持真实，只替换设备、阶段和回放边界。
 * @param calls - 本次调用记录。
 * @param levelUp - 当前升级采集器。
 */
function zhajinhuaFlow(calls, levelUp) {
  return loadGameFlow('./zhajinhua-gameplay.ts', {
    '@playwright/test': { expect },
    '../e2e/helpers/zhajinhua-scenes': { /** 返回本测试的场景参数。 */ restoreTable: () => ({ scene: 'restore' }) },
    './game-controls': {
      gameReady: gameFlowStep(calls, 'ready'),
      /** 模拟五个可见玩家，仅用于阶段准备断言。 */
      gameNodes: async () => Array.from({ length: 5 }, (_, index) => ({ res: `zhajinhua-player-container-${index}` })),
    },
    './game-feedback': { captureGameFeedback: gameFlowStep(calls, 'feedback') },
    './game-panel-animation': { captureTimedLevelUp: levelUp },
    './game-replay': { /** 保留当前房间的回放载荷记录。 */ gameReplaySender: () => gameFlowStep(calls, 'send') },
    './zhajinhua-gameplay-support': { expectZhajinhuaBalance: gameFlowStep(calls, 'balance') },
    './zhajinhua-gameplay-table': { zhajinhuaTable: gameFlowStep(calls, 'table') },
  });
}

/** 控制接口的调用记录与成功计数。
 * @param calls - 本次调用记录。
 */
function proxyFor(calls) {
  return {
    /** 记录真实源码所选择的控制命令。
     * @param method - 控制命令。
     * @param data - 原样记录的载荷。
     */
    command: async (method, data) => { calls.push([method, data]); return { replayedMessages: 1, blockedRpcs: 1 }; },
  };
}

for (const phase of ['all', 'table']) {
  test(`拼三张 ${phase} 非动画阶段保持牌桌及最终回放断言`, async () => {
    const calls = [];
    const { zhajinhuaGameplay } = zhajinhuaFlow(calls, gameFlowStep(calls, 'level-up'));
    await zhajinhuaGameplay({}, proxyFor(calls), 'room-1', 'self-1', gameFlowStep(calls, 'capture'), undefined, phase);
    assert.deepEqual(calls.map(([name]) => name), ['table', 'status']);
  });
}

test('拼三张独立效果房间先重建结算，升级失败仍撤销本轮奖励控制', async () => {
  const calls = [];
  const failure = new Error('level-up failed');
  const { zhajinhuaGameplay } = zhajinhuaFlow(calls, async () => { throw failure; });
  await assert.rejects(zhajinhuaGameplay({}, proxyFor(calls), 'room-1', 'self-1',
    gameFlowStep(calls, 'capture'), {}, 'effects'), failure);
  assert.deepEqual(calls.filter(([name]) => name === 'send').map(([, data]) => data), [
    { scene: 'restore' }, { scene: 'showdown' }, { scene: 'settlement' },
    { scene: 'new-game' }, { scene: 'restore' }, { scene: 'room-status' },
  ]);
  assert.deepEqual(calls.filter(([name]) => name === 'zhajinhua/operation-reward'), [
    ['zhajinhua/operation-reward', { roomId: 'room-1', enabled: true }],
    ['zhajinhua/operation-reward', { roomId: 'room-1', enabled: false }],
  ]);
  assert.equal(calls.some(([name]) => name === 'status'), false);
});
