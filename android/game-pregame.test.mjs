import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameFlow, gameFlowStep } from './game-flow-fixture.mjs';

const phases = [
  ['texas-holdem', 'all', ['opening', 'panels', 'final']],
  ['texas-holdem', 'first', ['opening']],
  ['texas-holdem', 'middle', ['panels']],
  ['texas-holdem', 'second', ['final']],
  ['zhajinhua', 'all', ['opening', 'panels', 'final']],
  ['zhajinhua', 'first', ['opening', 'panels']],
  ['zhajinhua', 'middle', ['panels']],
  ['zhajinhua', 'second', ['final']],
];
for (const [game, phase, expected] of phases) {
  test(`${game}/${phase} 保持独立房间阶段顺序和原始上下文`, async () => {
    const calls = [];
    const ready = [];
    const { gamePreGame } = loadGameFlow('./game-pregame.ts', {
      './game-controls': { gameReady: gameFlowStep(ready, 'ready') },
      './game-pregame-phases': {
        preGameOpening: gameFlowStep(calls, 'opening'),
        preGamePanels: gameFlowStep(calls, 'panels'),
        preGameFinal: gameFlowStep(calls, 'final'),
      },
      './game-pregame-helpers': {},
    });
    const device = {};
    const capture = /** 接受原样传递的共享截图入口。 */ async () => {};
    const animationInfo = {};
    await gamePreGame(device, game, capture, animationInfo, phase);
    assert.deepEqual(calls.map(([name]) => name), expected);
    assert.equal(ready[0][3], 'TestRoom');
    for (const [, context] of calls) assert.deepEqual(context, { device, game, capture, animationInfo });
  });
}

test('未指定阶段仍执行完整开局前流程', async () => {
  const calls = [];
  const step = gameFlowStep(calls, 'step');
  const { gamePreGame } = loadGameFlow('./game-pregame.ts', {
    './game-controls': { /** 接受就绪等待。 */ gameReady: async () => {} },
    './game-pregame-phases': { preGameOpening: step, preGamePanels: step, preGameFinal: step },
    './game-pregame-helpers': {},
  });
  await gamePreGame({}, 'texas-holdem', async () => {});
  assert.equal(calls.length, 3);
});

for (const [game, state, waits, method] of [
  ['texas-holdem', 'renew', true, 'motionFrames'], ['texas-holdem', 'settings', false, 'videoFrames'],
  ['zhajinhua', 'buy_in', true, 'videoFrames'], ['zhajinhua', 'renew', false, 'videoFrames'],
]) {
  test(`${game}/${state} 退场仅对已确认重连路径等待终点，保留采样方式`, async () => {
    let connecting = false, queries = 0;
    const transitions = [];
    const { capturePreGamePanel } = loadGameFlow('./game-pregame-panels.ts', {
      '@playwright/test': await import('@playwright/test'),
      '../visual/fixtures/account-presentation.json': { default: { balance: '100' } },
      './game-controls': {
        /** 模拟弹层已退场。 */ gameGone: async () => {},
        /** 点击由动画边界单独测试。 */ gameTap: async () => {},
        /** 返回续费已加载的真实语义值。
         * @param _device - 隔离设备。
         * @param res - 业务标记。
         */
        gameReady: async (_device, res) => ({ text: res.includes('spend') ? '1' : '100' }),
        /** 德州复用稳定连接等待，断言原有两秒稳定预算。
         * @param _device - 隔离设备。
         * @param stableMs - 连续稳定预算。
         */
        gameConnected: async (_device, stableMs) => { assert.equal(stableMs, 2_000); queries = 2; },
        /** 重连遮罩只在第一次查询可见。 */
        gameNodes: async () => {
          queries++;
          const nodes = connecting ? [{ text: 'Connecting...' }] : [];
          connecting = false;
          return nodes;
        },
      },
      './game-capture-retry': { /** 静态截图不是本测试边界。 */ captureConnected: async () => {} },
      './game-panel-animation': {
        /** 在原采样结束、终点截图前执行就绪回调。
         * @param args - 原生动画参数。
         */
        animateGamePanel: async (...args) => {
          transitions.push(args);
          if (args[6] !== 'exit') return;
          connecting = true;
          queries = 0;
          for (const hook of [args[9], args[11]].filter(Boolean)) await hook();
        },
      },
    });
    const animationInfo = {};
    await capturePreGamePanel({ device: {}, game, animationInfo }, state, 'ready', 'close');
    assert.equal([transitions[1][9], transitions[1][11]].some(Boolean), waits);
    assert.equal(queries, Number(waits) * 2);
    assert.equal(transitions[1][7], method);
    assert.equal(transitions[1][5], animationInfo);
  });
}
