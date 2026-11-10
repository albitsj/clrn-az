/** 验证密码页旁路诊断保留比较结果、原始异常和有限的脱敏证据。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

/** 运行真实诊断包装，仅替换设备、比较和报告边界。
 * @param failures - 指定比较或诊断故障。
 */
function passwordScene(failures = {}) {
  const attachments = [], samples = [];
  const originalError = new Error('原始截图比较失败');
  const masks = [{ x: 1, y: 2, width: 3, height: 4, reason: '原有遮罩' }];
  const device = {
    /** 比较器请求一次才生成一帧，诊断不能追加采样。 */
    screenshot: async () => {
      const body = Buffer.from(`sample-${samples.length}`);
      samples.push(body);
      return body;
    },
    /** 返回含私密文字的节点，生产诊断只能挑选几何字段。 */
    info: async () => ({ bounds: { x: 1, y: 2, width: 3, height: 4 }, focused: false, text: 'PRIVATE_PASSWORD' }),
  };
  const info = { retry: 1,
    /** 模拟附件写入故障并记录成功附件。
     * @param name - 附件名。
     * @param data - 附件内容。
     */
    attach: async (name, data) => {
      if (failures.phase === 'attachment') throw new Error('附件不可写');
      attachments.push([name, data]);
    },
  };
  const { compareResetPassword } = loadGameFlow('./reset-password-diagnostics.ts', {
    './device': {
      /** 配置查询失败不得改变测试结论。 */
      adb: () => {
        if (failures.phase === 'configuration') throw new Error('ADB 不可用');
        return 'fixed';
      },
      /** 沿用原比较器的参数和采样调用，模拟真实比较结果。
       * @param args - 比较器参数。
       */
      compareScreenshot: async (...args) => {
        assert.equal(args[0], device);
        assert.equal(args[3], masks);
        for (let index = 0; index < 15; index++) await args[5]();
        if (failures.comparison) throw originalError;
      },
    },
  });
  return { attachments, samples, originalError,
    /** 执行真实包装。 */
    run: () => compareResetPassword(device, 'password', info, masks),
  };
}

test('复用原比较采样，只保留前十二帧与末帧，不保存密码字段', async () => {
  const scene = passwordScene();
  await scene.run();
  assert.equal(scene.samples.length, 15, '诊断不得新增截图或比较重试');
  const frames = scene.attachments.filter(([name]) => name.includes('-sample-'));
  assert.equal(frames.length, 13);
  assert.deepEqual(frames.map(([, data]) => data.body), [...scene.samples.slice(0, 12), scene.samples.at(-1)]);
  const layout = JSON.parse(scene.attachments.at(-1)[1].body);
  assert.equal(layout.retry, 1);
  assert.equal(layout.inputs.length, 4);
  assert.equal(JSON.stringify(layout).includes('PRIVATE_PASSWORD'), false);
  assert.deepEqual(Object.keys(layout.inputs[0]), ['res', 'bounds', 'focused']);
});

for (const [phase, comparison] of [
  ['attachment', true], ['attachment', false], ['configuration', true], ['configuration', false],
]) {
  test(`${phase} 诊断故障保留原比较结果：comparison=${comparison}`, async () => {
    const scene = passwordScene({ phase, comparison });
    if (comparison) await assert.rejects(scene.run(), error => error === scene.originalError);
    else await assert.doesNotReject(scene.run());
  });
}
