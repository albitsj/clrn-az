/** 定向诊断不得重发回放、改变采样参数或覆盖原结果。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

for (const stage of ['success', 'trigger', 'sampling']) {
  for (const diagnosticFails of [false, true]) {
    test(`操作按钮诊断保留 ${stage} 结果，附件失败=${diagnosticFails}`, async () => {
      const failure = new Error('original failure');
      let sends = 0, captures = 0;
      const attachments = [];
      const { captureOperationTransition } = loadGameFlow('./texas-operation-diagnostics.ts', {
        './animation-transition': {
          /** 执行真实触发回调，模拟原生采样完成或原始错误。
           * @param args - 生产采样器参数。
           */
          captureNativeTransition: async (...args) => {
            captures++;
            assert.equal(args[1], 'texas-operation-buttons');
            assert.deepEqual(args[3], { x: 100, y: 865, width: 500, height: 150 });
            assert.deepEqual(args.slice(5, 9), [[], [], 400, 'motionFrames']);
            args[16]('native-sampling-start');
            await args[4]();
            args[16]('native-sampling-complete');
            if (stage === 'sampling') throw failure;
          },
        },
      });
      const rejectAttachment = attachmentFailure(stage);
      const info = {
        /** 附件同步或异步失败均不得影响原结果。
         * @param name - 附件名称。
         * @param value - 脱敏时间线。
         */
        attach: (name, value) => {
          attachments.push({ name, trace: JSON.parse(value.body) });
          if (diagnosticFails) return rejectAttachment();
          return Promise.resolve();
        },
      };
      const pending = captureOperationTransition({}, info, async () => {
        sends++;
        if (stage === 'trigger') throw failure;
      });
      if (stage === 'success') await pending;
      else await assert.rejects(pending, error => error === failure);
      assert.equal(captures, 1);
      assert.equal(sends, 1);
      assert.equal(attachments.length, 1);
      assert.equal(attachments[0].name, 'texas-operation-buttons-replay-trace');
      assert.deepEqual(attachments[0].trace.events.map(item => item.event), stage === 'trigger'
        ? ['native-sampling-start', 'own-turn-send-start']
        : ['native-sampling-start', 'own-turn-send-start', 'own-turn-send-complete', 'native-sampling-complete']);
      assert.ok(attachments[0].trace.events.every(item => Object.keys(item).sort().join() === 'at,event'));
    });
  }
}

/** 同时覆盖同步与异步附件异常。
 * @param stage - 原始执行结果。
 */
function attachmentFailure(stage) {
  return stage === 'success'
    ? () => { throw new Error('sync attachment failure'); }
    : () => Promise.reject(new Error('async attachment failure'));
}
