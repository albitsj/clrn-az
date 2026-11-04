import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameFlow, gameFlowStep } from './game-flow-fixture.mjs';

test('德州翻牌只恢复上一街一次，终止时原样传播错误', async () => {
  const calls = [];
  let captures = 0;
  const terminal = { /** 最后一次失败不能为了重试而读取此文字。 */ toString() { throw new Error('unexpected stringify'); } };
  const { texasRestore } = loadGameFlow('./texas-gameplay-restore.ts', {
    '@playwright/test': {},
    '../e2e/helpers/game-scenes': {
      /** 记录原样选择的上一街。
       * @param street - 回放街名。
       */
      restoreTable: street => ({ street }),
    },
    './animation-transition': {
      /** 首次缺少中途采样；第二次传播终止错误。 */
      captureNativeTransition: async () => {
        captures++;
        if (captures === 1) throw new Error('必须采到起点和终点之间的真实动画帧');
        throw terminal;
      },
    },
    './game-controls': {},
    './game-replay': {
      gameCardNames: gameFlowStep(calls, 'cards'),
      /** 返回当前房间的回放记录器。 */ gameReplaySender: () => gameFlowStep(calls, 'send'),
    },
  });
  await assert.rejects(texasRestore({ device: {}, proxy: {}, room: 'room-1', self: 'self-1', animationInfo: {} })('flop'),
    error => error === terminal);
  assert.equal(captures, 2);
  assert.deepEqual(calls.map(([name]) => name), ['send', 'cards']);
  assert.deepEqual(calls[0][1], { street: 'preflop' });
  assert.deepEqual(calls[1][4], ['back', 'back', 'back', 'back', 'back']);
});
