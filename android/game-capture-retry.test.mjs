import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameFlow, gameFlowStep } from './game-flow-fixture.mjs';

/** 仅替换设备重连查询，重采条件与两次上限执行当前源码。
 * @param calls - 本次设备调用。
 * @param connecting - 实际查询是否仍有重连提示。
 */
function connectedCapture(calls, connecting) {
  return loadGameFlow('./game-capture-retry.ts', {
    './game-controls': {
      gameConnected: gameFlowStep(calls, 'connected'),
      /** 返回本测试的查询结果。 */ gameNodes: async () => [],
      /** 返回显式的重连状态。 */ nodesConnecting: () => connecting,
    },
  }).captureConnected;
}

test('只重采重连打断的稳定截图，第二次成功后停止', async () => {
  const calls = [];
  let captures = 0;
  await connectedCapture(calls, true)({}, async () => {
    captures++;
    if (captures === 1) throw new Error('页面像素必须保持稳定');
  }, 'same-state');
  assert.equal(captures, 2);
  assert.deepEqual(calls.map(([, , duration]) => duration), [2000, 2000]);
});

test('第二次失败原样传播，不读取该错误文字或增加第三次尝试', async () => {
  let captures = 0;
  const terminal = { /** 终止分支不能为了判断重试而读取此文字。 */ toString() { throw new Error('unexpected stringify'); } };
  await assert.rejects(connectedCapture([], true)({}, async () => {
    captures++;
    if (captures === 1) throw new Error('页面像素必须保持稳定');
    throw terminal;
  }, 'same-state'), error => error === terminal);
  assert.equal(captures, 2);
});

test('没有真实重连提示时立即传播原始错误', async () => {
  const failure = { /** 非重连分支也不能读取错误文字。 */ toString() { throw new Error('unexpected stringify'); } };
  const calls = [];
  await assert.rejects(connectedCapture(calls, false)({}, async () => { throw failure; }, 'same-state'),
    error => error === failure);
  assert.equal(calls.length, 1);
});
