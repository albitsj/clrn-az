import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { loadGameFlow, gameFlowStep } from './game-flow-fixture.mjs';

/** 明确替换设备/回放边界，阶段分派与准备结算仍执行真实源码。
 * @param calls - 本次调用记录。
 */
function texasFlow(calls) {
  return loadGameFlow('./texas-gameplay.ts', {
    '@playwright/test': { expect },
    './game-controls': { gameReady: gameFlowStep(calls, 'ready') },
    './game-feedback': { captureGameFeedback: gameFlowStep(calls, 'feedback') },
    './game-replay': { /** 为同一房间记录回放载荷。 */ gameReplaySender: () => gameFlowStep(calls, 'send') },
    './texas-gameplay-profiles': { texasGameplayProfiles: gameFlowStep(calls, 'profiles') },
    './texas-gameplay-restore': { /** 返回当前房间恢复入口。 */ texasRestore: () => gameFlowStep(calls, 'restore') },
    './texas-gameplay-table': { texasGameplayTable: gameFlowStep(calls, 'table') },
    './texas-support': { expectTexasBalance: gameFlowStep(calls, 'balance') },
  });
}

const phases = [
  ['all', ['table', 'feedback', 'profiles']],
  ['table', ['table']],
  ['effects', ['restore', 'send', 'ready', 'send', 'send', 'balance', 'feedback', 'status']],
  ['profiles', ['restore', 'send', 'ready', 'send', 'send', 'balance', 'profiles']],
];
for (const [phase, expected] of phases) {
  test(`德州 ${phase} 保持牌桌、效果、资料和结算准备的顺序`, async () => {
    const calls = [];
    const { texasGameplay } = texasFlow(calls);
    const proxy = {
      /** 仅记录控制接口调用，不产生网络响应。
       * @param method - 当前控制命令。
       */
      command: async method => { calls.push([method]); return { replayedMessages: 1 }; },
    };
    await texasGameplay({}, proxy, 'room-1', 'self-1', gameFlowStep(calls, 'capture'), {}, phase);
    assert.deepEqual(calls.map(([name]) => name), expected);
    assert.deepEqual(calls.filter(([name]) => name === 'send').map(([, data]) => data), settlementScenes(phase));
  });
}

/** 只有独立效果和资料房间需要重建结算牌桌。
 * @param phase - 当前阶段。
 */
function settlementScenes(phase) {
  if (phase === 'all' || phase === 'table') return [];
  return [{ scene: 'all-in' }, { scene: 'showdown' }, { scene: 'settlement' }];
}

test('德州非动画完整流程不调用反馈采集，默认阶段仍包含资料', async () => {
  const calls = [];
  await texasFlow(calls).texasGameplay({}, {}, 'room', 'self', gameFlowStep(calls, 'capture'));
  assert.deepEqual(calls.map(([name]) => name), ['table', 'profiles']);
});
