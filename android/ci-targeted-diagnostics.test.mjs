import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

const require = createRequire(import.meta.url);
const { preserveCaretFailure } = loadGameFlow('./game-input-caret.ts', {
  '@playwright/test': require('@playwright/test'), './screenshot': {}, './game-controls': {},
});
const original = new Error('original failure');
const sample = { before: Buffer.from('before'), after: Buffer.from('after'),
  input: { bounds: { x: 1, y: 2, width: 3, height: 4 }, focused: true, text: 'private text' } };

for (const missing of [false, true]) {
  test(`页码诊断保留原采样与断言，零采样=${missing}`, async () => {
    const attachments = [];
    let calls = 0;
    const { recordPageCaret } = loadGameFlow('./record-page-caret.ts', {
      '@playwright/test': require('@playwright/test'),
      './game-input-caret': { preserveCaretFailure },
      './screenshot': {
        /** 使用原默认选择器，不增加采样或重新聚焦。
         * @param device - 当前设备。
         * @param selector - 应保持原默认值。
         * @param observe - 原采样回调。
         */ focusedCaretMask: async (device, selector, observe) => {
          calls++;
          assert.equal(selector, undefined);
          if (!missing) observe(sample);
          return undefined;
        },
      },
    });
    await assert.rejects(recordPageCaret({}, {
      /** 收集脱敏附件。
       * @param name - 附件名。
       * @param data - 附件内容。
       */ attach: async (name, data) => { attachments.push({ name, ...data }); },
    }), /页码输入框应检测到真实细光标/);
    assert.equal(calls, 1);
    const state = JSON.parse(attachments[0].body);
    assert.equal(state.samples.length, missing ? 0 : 1);
    assert.equal(attachments[0].body.includes('private text'), false);
    assert.equal(attachments.length, missing ? 1 : 3);
  });
}

test('页码诊断附件失败不能覆盖采样异常', async () => {
  const { recordPageCaret } = loadGameFlow('./record-page-caret.ts', {
    '@playwright/test': require('@playwright/test'), './game-input-caret': { preserveCaretFailure },
    './screenshot': { /** 原采样异常。 */ focusedCaretMask: async () => { throw original; } },
  });
  await assert.rejects(recordPageCaret({}, {
    /** 模拟报告故障。 */ attach: async () => { throw new Error('attachment failure'); },
  }), error => error === original);
});

for (const fail of [false, true]) {
  test(`操作按钮时间线不改变采样参数、请求次数与结果，失败=${fail}`, async () => {
    let sends = 0;
    const attachments = [];
    const { captureOperationTransition } = loadGameFlow('./texas-operation-transition.ts', {
      './animation-transition': {
        /** 核对原有调用参数与执行顺序。
         * @param args - 原转场参数。
         */ captureNativeTransition: async (...args) => {
          assert.equal(args[1], 'texas-operation-buttons');
          assert.deepEqual(args[3], { x: 100, y: 865, width: 500, height: 150 });
          assert.deepEqual(args.slice(5, 8), [[], [], 400]);
          assert.ok(args.slice(8, 16).every(value => value === undefined));
          args[16]('native-sampling-start');
          await args[4]();
          if (fail) throw original;
        },
      },
    });
    const run = captureOperationTransition({}, {
      /** 记录内容并模拟附件失败。
       * @param name - 固定附件名。
       * @param data - 脱敏时间线。
       */ attach: async (name, data) => {
        attachments.push({ name, ...data });
        throw new Error('attachment failure');
      },
    }, async () => { sends++; });
    if (fail) await assert.rejects(run, error => error === original);
    else await run;
    assert.equal(sends, 1);
    assert.equal(attachments[0].name, 'texas-operation-buttons-trigger-timing');
    assert.deepEqual(JSON.parse(attachments[0].body).map(item => item.event),
      ['native-sampling-start', 'trigger-start', 'trigger-complete']);
  });
}
