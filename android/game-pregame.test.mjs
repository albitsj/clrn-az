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
