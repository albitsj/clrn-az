/** 游客动画初始化首败必须在关闭设备前保留，诊断故障不能替换原错误。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { diagnosticSource } from './diagnostics-test-support.mjs';

/** 执行真实用例的初始化失败路径，只替换设备与报告边界。
 * @param diagnosticsFail - 是否模拟附件存储故障。
 */
async function runInitializationFailure(diagnosticsFail) {
  const failure = new Error('原始初始化超时');
  const device = {}, report = {}, calls = [];
  let guest;
  const modules = {
    '@playwright/test': {
      /** 仅登记目标用例，其他用例不执行。
       * @param name - 用例名称。
       * @param callback - 实际用例。
       */
      test: (name, callback) => { if (name.startsWith('guest search confirmation')) guest = callback; },
    },
    './support/selection': { /** 保留原配置调用，不改变测试的初始化路径。 */ configureEnglishAnimation: () => {} },
    '../device': {
      /** 返回已连接的专用设备。 */
      launchApplication: async () => { calls.push('launch'); return device; },
      /** 首次真实初始化失败，不能重新启动或重试本用例。 */
      waitForHall: async () => { calls.push('initialize'); throw failure; },
    },
    '../proxy': { /** 保持原代理作用域。
       * @param callback - 实际测试路径。
       */ withAndroidProxy: async callback => callback() },
    './support/lifecycle': {
      /** 记录诊断发生时仍为原设备和原报告。
       * @param current - 设备。
       * @param info - 报告。
       */ captureDeviceFailure: async (current, info) => {
        assert.equal(current, device);
        assert.equal(info, report);
        calls.push('diagnostics');
        if (diagnosticsFail) throw new Error('附件故障');
      },
      /** 原有 finally 仍释放设备。 */
      closeDevice: async () => { calls.push('close'); },
    },
  };
  runInNewContext(diagnosticSource('./tests/animation-transitions.spec.ts'), {
    /** 无关依赖不会进入初始化失败路径。
     * @param name - 依赖名称。
     */ require: name => modules[name] || {}, exports: {},
  });
  await assert.rejects(guest({}, report), error => error === failure);
  assert.deepEqual(calls, ['launch', 'initialize', 'diagnostics', 'close']);
}

test('首次初始化失败先取证再关闭，且附件故障仍抛出原始初始化异常', async () => {
  await runInitializationFailure(false);
  await runInitializationFailure(true);
});
