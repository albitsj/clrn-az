/** 起手牌首败诊断须保留发送时序与原错误，不能重发或改变采样参数。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL('./texas-gameplay-restore.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

for (const diagnosticFails of [false, true]) {
  test(`起手牌发送完成后采样失败仍传播原错，诊断失败=${diagnosticFails}`, async () => {
    const failure = new Error('录屏结束时动画必须完成');
    const calls = [], attachments = [];
    const modules = {
      '@playwright/test': require('@playwright/test'),
      '../e2e/helpers/game-scenes': require('../e2e/helpers/game-scenes.ts'),
      './game-controls': {},
      './game-replay': {
        /** 不访问代理，仅记录实际请求的命名场景。 */
        gameReplaySender: () => async scene => { calls.push(scene.part); },
      },
      './animation-transition': {
        /** 执行真实触发回调；只在采集结果边界注入本轮断言错误。
         * @param args - 原采样参数。
         */
        captureNativeTransition: async (...args) => {
          assert.equal(args[7], 0);
          assert.equal(args[8], 'videoFrames');
          args[16]('video-recording-start');
          await args[4]();
          throw failure;
        },
      },
    };
    const exports = {};
    runInNewContext(source, { exports, Date, setTimeout,
      /** 仅替换外部设备与采集边界。
       * @param name - 生产模块名称。
       */
      require: name => modules[name] });
    const context = { animationInfo: {
      /** 保存真实时间线或模拟附件失败。
       * @param name - 附件名。
       * @param value - 附件内容。
       */
      attach: async (name, value) => {
        attachments.push({ name, trace: JSON.parse(value.body) });
        if (diagnosticFails) throw new Error('attachment unavailable');
      },
    } };
    await assert.rejects(exports.texasRestore(context)('preflop'), error => error === failure);
    assert.deepEqual(calls, ['without-hand', 'hand']);
    assert.equal(attachments.length, 1);
    const { trace } = attachments[0];
    assert.deepEqual(trace.events.map(item => item.event), ['video-recording-start',
      'without-hand-send-start', 'without-hand-send-complete', 'hand-send-start', 'hand-send-complete']);
    assert.ok(trace.events[3].at - trace.events[2].at >= 350);
    assert.ok(trace.events.every(item => Object.keys(item).sort().join() === 'at,event'));
  });
}
