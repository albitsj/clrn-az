import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

/** 只替换外部采集及诊断边界，检查原触发、参数和错误传播。
 * @param failure - 原转场的失败，undefined 表示正常完成。
 * @param diagnosticsFail - 模拟诊断本身不可用。
 */
function scene(failure, diagnosticsFail = false) {
  const events = [], attachments = [];
  let parameters;
  const { captureChatExitWithDiagnostics } = loadGameFlow('./game-chat-exit-diagnostics.ts', {
    './animation-transition': {
      /** 保留完整公开采集参数，并执行原触发一次。
       * @param args - 转场参数及只读阶段观察器。
       */
      captureNativeTransition: async (...args) => {
        parameters = args;
        args[16]('start-screenshot-start');
        args[16]('video-recording-start');
        args[4]();
        events.push('capture-complete');
        if (failure) throw failure;
      },
    },
    './game-panel-diagnostics': {
      /** 只附加固定阶段，禁止设备调用。
       * @param trace - 当前尝试的时间线。
       * @param event - 固定阶段。
       */
      tracePanelTarget: (trace, event) => trace.events.push({ event }),
    },
    './animation-diagnostics': { /** 保存已有日志只发生在采集失败后。 */
      preserveAnimationFailure: async () => { events.push('logs'); if (diagnosticsFail) throw new Error('PRIVATE'); },
    },
    './render-diagnostics': { /** 渲染诊断失败也不能阻断原错误。 */
      preserveRenderStatistics: async () => { events.push('render'); if (diagnosticsFail) throw new Error('PRIVATE'); },
    },
  });
  const context = { device: {}, game: 'texas-holdem', animationInfo: {
    /** 附件失败不能改变测试结果。
     * @param name - 固定附件名。
     * @param data - 无文字或身份的时间线。
     */
    attach: async (name, data) => { attachments.push([name, JSON.parse(data.body)]); if (diagnosticsFail) throw new Error('PRIVATE'); },
  } };
  return { events, attachments, context,
    /** 执行生产包装，保留原遮罩点击次数。 */
    run: () => captureChatExitWithDiagnostics(context, () => events.push('tap')),
    /** 返回采集参数供检查。 */ args: () => parameters,
  };
}

test('聊天退场保持原采集参数、单次触发，成功路径仅附加阶段时间线', async () => {
  const current = scene();
  await current.run();
  assert.deepEqual(current.events, ['tap', 'capture-complete']);
  assert.deepEqual(current.args().slice(0, 4), [current.context.device, 'texas-holdem-chat-exit',
    current.context.animationInfo, { x: 110, y: 760, width: 140, height: 500 }]);
  assert.deepEqual(current.args().slice(5, 16), [[], [], 0, 'videoFrames',
    undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual(current.attachments[0][1].events.map(event => event.event),
    ['start-screenshot-start', 'video-recording-start', 'trigger-start', 'trigger-complete']);
});

for (const diagnosticsFail of [false, true]) test(`每次退场失败立即保留现场，诊断失败=${diagnosticsFail} 不替换原错误`, async () => {
  const failure = new Error('必须采到起点和终点之间的真实动画帧');
  const current = scene(failure, diagnosticsFail);
  for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(current.run(), error => error === failure);
  assert.deepEqual(current.events, Array(3).fill(['tap', 'capture-complete', 'logs', 'render']).flat());
  assert.equal(current.attachments.length, 3);
  assert.equal(JSON.stringify(current.attachments).includes('PRIVATE'), false);
});
