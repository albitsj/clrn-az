import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

test('聊天渲染诊断只保留数字统计，不重置统计且设备或附件失败不外抛', async () => {
  const calls = [], attachments = [];
  let unavailable = false;
  const { preserveRenderStatistics } = loadGameFlow('./render-diagnostics.ts', {
    './device': { applicationId: 'test.application',
      /** 模拟设备已有统计；禁止读取其他设备信息。
       * @param args - 只读统计命令。
       */
      adb: (...args) => {
        calls.push(args);
        if (unavailable) throw new Error('PRIVATE_DEVICE_ERROR');
        return 'Window: PRIVATE_CHAT\nTotal frames rendered: 120\nJanky frames: 3 (2.5%)\n0,100,-200,300,\n';
      },
    },
  });
  const info = { /** 保存脱敏附件。
   * @param name - 固定附件名。
   * @param data - 结构化统计。
   */ attach: async (name, data) => attachments.push([name, JSON.parse(data.body)]) };
  await preserveRenderStatistics('texas-holdem-chat-enter', info);
  assert.deepEqual(calls, [['shell', 'dumpsys', 'gfxinfo', 'test.application', 'framestats']]);
  assert.deepEqual(attachments[0][1].statistics, {
    summary: [{ metric: 'Total frames rendered', count: 120 }, { metric: 'Janky frames', count: 3 }],
    frames: [[0, 100, -200, 300]],
  });
  assert.equal(typeof attachments[0][1].capturedAt, 'number');
  assert.equal(JSON.stringify(attachments).includes('PRIVATE'), false);
  await preserveRenderStatistics('zhajinhua-chat-enter', info);
  assert.equal(calls.length, 1);
  unavailable = true;
  await preserveRenderStatistics('texas-holdem-chat-enter', info);
  unavailable = false;
  await preserveRenderStatistics('texas-holdem-chat-enter', {
    /** 附件失败不能替换原始动画异常。 */ attach: async () => { throw new Error('PRIVATE_REPORT_ERROR'); },
  });
  assert.equal(attachments.length, 1);
  await preserveRenderStatistics('texas-holdem-chat-exit', info);
  assert.equal(attachments[1][0], 'texas-holdem-chat-exit-render-statistics');
  assert.deepEqual(calls.at(-1), ['shell', 'dumpsys', 'gfxinfo', 'test.application', 'framestats']);
});
