import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { capturePredictionResult } = require('./game-transient.ts');

test('预测结果先开始原生采集再发送事件，缺少真实提示帧时仍然失败', async () => {
  const order = [];
  let finish;
  const device = { _connection: { /** 返回本测试的原生驱动替身。 */ toImpl: () => ({
    /** 记录原生采集开始时间，并等待回放事件。
     * @param method - 原生驱动方法。
     * @param parameters - 提示节点参数。
     */
    _send: (method, parameters) => {
      assert.equal(method, 'transientFrames');
      assert.deepEqual(parameters, { resource: 'bet-next-hand-result-amount' });
      order.push('开始采集');
      return new Promise(resolve => { finish = resolve; });
    },
  }) } };
  const attachments = [];
  const testInfo = {
    /** 记录失败时仍保留的采集元数据。
     * @param name - 附件名称。
     */
    attach: async name => { attachments.push(name); },
  };
  await assert.rejects(capturePredictionResult(device, '预测结果', testInfo, [], async () => {
    order.push('发送事件');
    finish([]);
    return '+10';
  }), /提示可见时必须采集至少两帧真实屏幕/);
  assert.deepEqual(order, ['开始采集', '发送事件']);
  assert.deepEqual(attachments, ['预测结果-frames']);
});

test('预测结果金额与回放事件不一致时拒绝截图', async () => {
  const marker = { text: '-10', bounds: { x: 170, y: 560, width: 380, height: 160 } };
  const frames = [0, 300].map(capturedAt => ({ before: marker, after: marker, panel: null,
    capturedAt, png: '' }));
  const device = { _connection: { /** 返回固定结果帧。 */ toImpl: () => ({
    /** 返回文字与预期金额不符的真实节点帧。 */ _send: async () => frames,
  }) } };
  const testInfo = { /** 接受采集元数据。 */ attach: async () => {} };
  await assert.rejects(capturePredictionResult(device, '预测结果', testInfo, [], async () => '+10'),
    /预测结果金额必须与回放事件一致/);
});
