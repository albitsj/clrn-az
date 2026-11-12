import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

for (const failure of [undefined, new Error('original animation failure')]) {
  for (const unavailable of [false, true]) test(`slot exit preserves capture and result: failure=${!!failure}, diagnostics unavailable=${unavailable}`, async () => {
    const calls = [], reports = [];
    let parameters;
    /** 模拟诊断自身失败，原测试结果必须保持。 */
    const diagnostic = async () => { if (unavailable) throw new Error('PRIVATE'); };
    const { captureSlotExitWithDiagnostics } = loadGameFlow('./slot-exit-diagnostics.ts', {
      './animation-transition': {
        /** 只替换设备边界，运行原触发和阶段观察器。
         * @param args - 原采集参数。
         */
        captureNativeTransition: async (...args) => {
          parameters = args;
          args[16]('video-recording-start');
          await args[4]();
          calls.push('capture');
          if (failure) throw failure;
        },
      },
      './animation-diagnostics': { /** 采样失败后保存既有日志。 */
        preserveAnimationFailure: async () => { calls.push('logs'); await diagnostic(); },
      },
      './render-diagnostics': { /** 诊断独立运行。 */
        preserveRenderStatistics: async () => { calls.push('render'); await diagnostic(); },
      },
    });
    const device = {};
    const info = { /** 保存脱敏报告，附件失败也不能影响结果。
     * @param name - 固定名称。
     * @param data - 阶段时间线。
     */ attach: async (name, data) => { reports.push([name, JSON.parse(data.body)]); await diagnostic(); } };
    /** 调用生产包装，检查错误身份及点击次数。 */
    const run = () => captureSlotExitWithDiagnostics(device, info, () => calls.push('tap'));
    if (failure) await assert.rejects(run(), error => error === failure);
    else await run();
    assert.deepEqual(parameters.slice(0, 4), [device, 'slot-popup-exit', info, { x: 0, y: 500, width: 720, height: 680 }]);
    assert.deepEqual(parameters.slice(5, 16), [[], [], 0, 'videoFrames', undefined, undefined, undefined,
      undefined, undefined, undefined, undefined]);
    assert.deepEqual(calls, failure ? ['tap', 'capture', 'logs', 'render'] : ['tap', 'capture']);
    assert.deepEqual(reports[0][1].events.map(item => item.event),
      ['video-recording-start', 'trigger-start', 'trigger-complete']);
    assert.equal(JSON.stringify(reports).includes('PRIVATE'), false);
  });
}
