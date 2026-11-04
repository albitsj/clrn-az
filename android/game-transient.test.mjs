import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { capturePredictionResult, captureToast } = require('./game-transient.ts');

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

/** 仅替换原生帧输入，沿用生产提示验证与稳定性选择。
 * @param frames - 采集器返回的节点和原始 PNG。
 */
function toastFrames(frames) {
  const attachments = [];
  const device = { _connection: { /** 返回本次采集器。 */ toImpl: () => ({
    /** 返回固定的原始采集输入。 */ _send: async () => frames,
  }) } };
  const info = { /** 保存附件名称以验证原始失败帧未被丢弃。
     * @param name - 附件名称。
     */
    attach: async name => { attachments.push(name); },
  };
  return { attachments, /** 执行真实提示验证。 */ run: () => captureToast(device, '提示', info, [], '40') };
}

const toast = { res: 'toastText1', text: 'Minimum Raise Is 40',
  bounds: { x: 80, y: 121, width: 570, height: 33 } };
const png = PNG.sync.write(new PNG({ width: 8, height: 8 })).toString('base64');

test('提示入场时面板尚未进入控件树的移动帧保留原图，但不能充当稳定相位', async () => {
  // 真实首败的前后边界：y0/6px -> y121/33px；panel 在首次读取时不存在。
  const before = { ...toast, bounds: { ...toast.bounds, y: 0, height: 6 } };
  const moving = { before, after: toast, panel: null, capturedAt: 0, png };
  const visible = { before: toast, after: toast, panel: toast, capturedAt: 300, png };
  const probe = toastFrames([moving, visible]);
  await assert.rejects(probe.run(), /必须连续稳定至少 250 毫秒/);
  assert.ok(probe.attachments.includes('提示-frame-0-original'));
  assert.equal(probe.attachments.includes('提示-frame-0-masks'), false);
});

test('位置已稳定却没有前景面板时仍拒绝，不能通过跳过面板检查接受错误提示', async () => {
  const frames = [0, 300].map(capturedAt => ({ before: toast, after: toast, panel: null, capturedAt, png }));
  await assert.rejects(toastFrames(frames).run(), /提示面板不能被背景遮罩覆盖/);
});
