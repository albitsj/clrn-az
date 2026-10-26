import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import childProcess from 'node:child_process';

const require = createRequire(import.meta.url);
const { waitForHall, waitForStagingNotice } = require('./device.ts');

test('启动后的真实状态接口网络错误只点击应用重试并等待进入大厅', async context => {
  const serial = process.env.ANDROID_SERIAL;
  process.env.ANDROID_SERIAL = 'emulator-5554';
  context.after(() => {
    if (serial === undefined) delete process.env.ANDROID_SERIAL;
    else process.env.ANDROID_SERIAL = serial;
  });
  context.mock.method(childProcess, 'execFileSync', (executable, argumentsList) => {
    assert.equal(executable, 'adb');
    assert.deepEqual(argumentsList, ['-s', 'emulator-5554', 'shell', 'dumpsys', 'input_method']);
    return 'mInputShown=false';
  });
  const taps = [];
  let hallChecks = 0;
  const device = {
    /** 模拟确认框已出现，以及第一次大厅等待遇到真实网络错误。
     * @param selector - 原生控件标识。
     */
    wait: async selector => {
      if (selector.res === 'staging-confirmation-input') return;
      assert.equal(selector.res, 'settings-tab');
      if (++hallChecks === 1) throw new Error('TimeoutError: androidDevice.wait: Timeout 5000ms exceeded.');
    },
    /** 返回状态接口错误及应用自己的重试按钮。
     * @param selector - 原生控件标识。
     */
    info: async selector => selector.res === 'android:id/message'
      ? { text: 'ServerType: staging\nMessage: 68 v1/status\nThere is a slight network issue, please retry.' }
      : { text: 'RETRY' },
    /** 记录真实点击，不替换应用响应。
     * @param selector - 原生控件标识。
     */
    tap: async selector => { taps.push(selector); },
    /** 模拟输入确认码。
     * @param selector - 原生控件标识。
     * @param value - 确认码。
     */
    fill: async (selector, value) => {
      assert.deepEqual(selector, { res: 'staging-confirmation-input' });
      assert.equal(value, 'CONFIRM');
    },
  };
  await waitForHall(device);
  assert.deepEqual(taps, [{ res: 'confirm-button' }, { res: 'android:id/button1' }]);
  assert.equal(hallChecks, 2);
});

test('启动确认框被 Pixel Launcher ANR 遮挡时只关闭系统弹窗并继续等待', async context => {
  const notices = [];
  const taps = [];
  let dismissed = false;
  context.mock.method(console, 'log', message => notices.push(message));
  const device = {
    /** 核对真实确认框查询，并模拟桌面弹窗遮挡。
     * @param selector - 原生控件标识。
     * @param options - 等待时限。
     */
    wait: async (selector, options) => {
      assert.deepEqual(selector, { res: 'staging-confirmation-input' });
      assert.deepEqual(options, { timeout: 30_000 });
      if (!dismissed) throw new Error('confirmation hidden by launcher');
    },
    /** 返回明确的系统桌面 ANR。
     * @param selector - 系统弹窗文本。
     */
    info: async selector => {
      assert.deepEqual(selector, { text: "Pixel Launcher isn't responding" });
      return { text: "Pixel Launcher isn't responding" };
    },
    /** 记录关闭系统弹窗。
     * @param selector - 关闭按钮标识。
     */
    tap: async selector => {
      taps.push(selector);
      dismissed = true;
    },
  };
  await waitForStagingNotice(device);
  assert.deepEqual(taps, [{ res: 'android:id/aerr_close' }]);
  assert.equal(notices.length, 1);
});

test('没有明确的 Pixel Launcher ANR 时保留应用启动失败且不关闭其他页面', async () => {
  const failure = new Error('app did not show staging confirmation');
  let attempts = 0;
  const device = {
    /** 模拟应用确认框未出现。 */
    wait: async () => { attempts++; throw failure; },
    /** 确认没有系统桌面 ANR。 */
    info: async () => undefined,
    /** 任何点击都说明误吞了应用故障。 */
    tap: async () => assert.fail('不得关闭其他页面'),
  };
  await assert.rejects(waitForStagingNotice(device), error => error === failure);
  assert.equal(attempts, 3);
});

test('Pixel Launcher ANR 持续出现时有界失败', async context => {
  const failure = new Error('confirmation remains hidden');
  let attempts = 0;
  let dismissed = 0;
  context.mock.method(console, 'log', () => {});
  const device = {
    /** 模拟确认框始终被遮挡。 */
    wait: async () => { attempts++; throw failure; },
    /** 模拟系统桌面 ANR 始终存在。 */
    info: async () => ({ text: "Pixel Launcher isn't responding" }),
    /** 记录每次明确的系统弹窗关闭操作。 */
    tap: async () => { dismissed++; },
  };
  await assert.rejects(waitForStagingNotice(device), error => error === failure);
  assert.equal(attempts, 3);
  assert.equal(dismissed, 2);
});
