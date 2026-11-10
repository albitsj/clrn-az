/** 诊断必须保留采样参数与原始失败，并拒绝复制未脱敏输出。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { diagnosticSource } from './diagnostics-test-support.mjs';

/** 在生产模块边界注入设备、代理及报告故障。
 * @param file - 生产文件。
 * @param modules - 已替换的外部边界。
 */
function load(file, modules) {
  const exports = {};
  runInNewContext(diagnosticSource(file), { exports, Date,
    /** 返回本例独立依赖。
     * @param name - 模块名称。
     */ require: name => modules[name] });
  return exports;
}

test('滚轮首败诊断不改变参数、不重试点击，所有诊断故障仍保留原异常', async () => {
  const failure = new Error('第 1 个区域必须独立运动');
  const device = {}, reels = [{ x: 143, y: 420, width: 137, height: 362 }];
  let calls = 0, clicks = 0;
  /** 记录原始点击次数，诊断不得重新触发。 */
  const trigger = () => { clicks++; };
  const { captureSlotSpin } = load('./slot-spin.ts', {
    './animation-transition': { /** 在原采样边界注入断言失败。
       * @param args - 完整生产参数。
       */ captureNativeTransition: async (...args) => {
      calls++;
      assert.equal(args[0], device);
      assert.equal(args[4], trigger);
      assert.equal(args[6], reels);
      assert.deepEqual(JSON.parse(JSON.stringify(args[3])), { x: 124, y: 420, width: 469, height: 362 });
      assert.equal(args[7], 1500);
      assert.equal(args[8], 'challengeFrames');
      await args[4]();
      args[16]('native-sampling-start');
      throw failure;
    } },
    './animation-diagnostics': { /** 附件失败不能替换断言。 */ preserveAnimationFailure: async () => { throw new Error('private'); } },
  });
  for (const commandFails of [false, true]) {
    const proxy = { /** 仅允许失败后读取状态，不可修改夹具。
       * @param endpoint - 控制接口。
       */ command: async endpoint => {
      assert.equal(endpoint, 'android/slot');
      if (commandFails) throw new Error('private');
      return { spins: 2, lastSpinAt: 123, token: 'must-not-copy' };
    } };
    const info = { /** 白名单响应字段不得包含代理额外数据。
       * @param name - 附件名称。
       * @param value - 附件数据。
       */ attach: async (name, value) => {
      assert.equal(name, 'slot-currency_diamond-reels-response-timing');
      assert.equal(value.body.includes('must-not-copy'), false);
      assert.equal(JSON.parse(value.body).lastSpinAt, 123);
      throw new Error('report failure');
    } };
    await assert.rejects(captureSlotSpin(device, proxy, 'currency_diamond', info, trigger, reels), error => error === failure);
  }
  assert.equal(calls, 2);
  assert.equal(clicks, 2);
});

test('渲染诊断只保留数字，设备读取与附件失败都不抛出', async () => {
  let failRead = false;
  const { renderStatistics, preserveRenderStatistics } = load('./render-diagnostics.ts', {
    './device': { applicationId: 'test.app', /** 模拟已有渲染统计读取，不重置数据。
       * @param args - 设备命令。
       */ adb: (...args) => {
      assert.deepEqual(args, ['shell', 'dumpsys', 'gfxinfo', 'test.app', 'framestats']);
      if (failRead) throw new Error('secret-device-payload');
      return 'Window: private-token\nTotal frames rendered: 42\n1,100,200,\n';
    } },
  });
  const stats = JSON.parse(JSON.stringify(renderStatistics('Window private\nJanky frames: 2 (5%)\n1,100,-1,\n')));
  assert.deepEqual(stats, { summary: [{ metric: 'Janky frames', count: 2 }], frames: [[1, 100, -1]] });
  const info = { /** 报告故障仍不能使诊断抛出。
     * @param name - 附件名。
     * @param value - 白名单数据。
     */ attach: async (name, value) => {
    assert.equal(value.body.includes('private-token'), false);
    throw new Error('secret-report-payload');
  } };
  await preserveRenderStatistics('texas-holdem-voice-enter', info);
  await preserveRenderStatistics('slot-popup-exit', info);
  failRead = true;
  await preserveRenderStatistics('texas-holdem-voice-enter', info);
  await preserveRenderStatistics('slot-popup-exit', info);
});
