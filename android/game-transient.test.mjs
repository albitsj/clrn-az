import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { capturePredictionResult, captureToast } = require('./game-transient.ts');

test('预测结果先开始原生采集再发送事件，缺少真实提示帧时仍然失败', async () => {
  const order = [];
  let finish;
  let token;
  const device = { _connection: { /** 返回本测试的原生驱动替身。 */ toImpl: () => ({
    /** 记录原生采集开始时间，并等待回放事件。
     * @param method - 原生驱动方法。
     * @param parameters - 提示节点参数。
     */
    _send: (method, parameters) => {
      assert.equal(method, 'transientFrames');
      assert.equal(parameters.resource, 'bet-next-hand-result-amount');
      token = parameters.readyToken;
      order.push('开始采集');
      return new Promise(resolve => { finish = resolve; });
    },
  }) } , /** 设备端确认已经开始监听本轮事件。 */ shell: async () => Buffer.from(token) };
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
  assert.deepEqual(attachments.slice(0, 2), ['预测结果-capture-window', '预测结果-frames']);
  assert.ok(attachments.includes('预测结果-diagnostics-window'), '零帧首败须保留日志窗口，避免重试轮转丢失现场');
});

test('预测结果金额与回放事件不一致时拒绝截图', async () => {
  const marker = { text: '-10', bounds: { x: 170, y: 560, width: 380, height: 160 } };
  const frames = [0, 300].map(capturedAt => ({ before: marker, after: marker, panel: null,
    capturedAt, png: '' }));
  let finish, token;
  const device = { _connection: { /** 返回固定结果帧。 */ toImpl: () => ({
    /** 采集在事件发生后返回。
     * @param _method - 原生方法。
     * @param parameters - 当前采集身份。
     */ _send: (_method, parameters) => { token = parameters.readyToken; return new Promise(resolve => { finish = resolve; }); },
  }) }, /** 当前设备的就绪标记。 */ shell: async () => Buffer.from(token) };
  const testInfo = { /** 接受采集元数据。 */ attach: async () => {} };
  await assert.rejects(capturePredictionResult(device, '预测结果', testInfo, [], async () => { finish(frames); return '+10'; }),
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
const metadata = readFileSync(new URL('./fixtures/toast-entry/frames.json', import.meta.url));

test('提示入场时面板尚未进入控件树的移动帧保留原图，但不能充当稳定相位', async () => {
  assert.equal(createHash('sha256').update(metadata).digest('hex'),
    'cf0fabee0ba58f5faa9f5e817802ee279b1d10affbe36f77232e71ec29fe3d18');
  // 沿用原始首败节点元数据；小 PNG 仅是测试像素，不冒充缺失的真实入场位图。
  const [moving, visible] = JSON.parse(metadata).slice(0, 2).map(frame => ({ ...frame, png }));
  const probe = toastFrames([moving, visible]);
  await assert.rejects(probe.run(), /必须连续稳定至少 250 毫秒/);
  assert.ok(probe.attachments.includes('提示-frame-0-original'));
  assert.equal(probe.attachments.includes('提示-frame-0-masks'), false);
});

test('位置已稳定却没有前景面板时仍拒绝，不能通过跳过面板检查接受错误提示', async () => {
  const frames = [0, 300].map(capturedAt => ({ before: toast, after: toast, panel: null, capturedAt, png }));
  await assert.rejects(toastFrames(frames).run(), /提示面板不能被背景遮罩覆盖/);
});
