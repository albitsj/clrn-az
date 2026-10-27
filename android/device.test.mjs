import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import childProcess from 'node:child_process';

const require = createRequire(import.meta.url);
const { waitForHall, waitForStagingNotice } = require('./device.ts');

test('启动后的状态接口连续四次网络错误仍在时限内重试并进入大厅', async context => {
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
    /** 模拟确认框已出现，以及前四次大厅等待遇到真实网络错误。
     * @param selector - 原生控件标识。
     */
    wait: async selector => {
      if (selector.res === 'staging-confirmation-input') return;
      assert.equal(selector.res, 'settings-tab');
      if (++hallChecks <= 4) throw new Error('TimeoutError: androidDevice.wait: Timeout 5000ms exceeded.');
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
  assert.deepEqual(taps, [{ res: 'confirm-button' }, ...Array.from({ length: 4 }, () => ({ res: 'android:id/button1' }))]);
  assert.equal(hallChecks, 5);
});

test('启动确认框被已确认的系统进程无响应弹窗遮挡时只关闭该弹窗', async context => {
  const notices = [];
  context.mock.method(console, 'log', message => notices.push(message));
  for (const title of ["Pixel Launcher isn't responding", "com.google.android.googlesdksetup isn't responding"]) {
    const taps = [];
    let dismissed = false;
    const device = {
      /** 核对真实确认框查询，并模拟系统弹窗遮挡。
       * @param selector - 原生控件标识。
       * @param options - 等待时限。
       */
      wait: async (selector, options) => {
        assert.deepEqual(selector, { res: 'staging-confirmation-input' });
        assert.deepEqual(options, { timeout: 30_000 });
        if (!dismissed) throw new Error('系统弹窗遮挡确认框');
      },
      /** 返回已确认的系统进程无响应弹窗。
       * @param selector - 系统弹窗标题控件。
       */
      info: async selector => {
        assert.deepEqual(selector, { res: 'android:id/alertTitle' });
        return { text: title };
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
  }
  assert.equal(notices.length, 2);
});

test('没有已确认的系统进程无响应弹窗时保留启动失败且不关闭其他页面', async () => {
  const failure = new Error('应用未显示预发布确认框');
  let attempts = 0;
  const device = {
    /** 模拟应用确认框未出现。 */
    wait: async () => { attempts++; throw failure; },
    /** 应用自身无响应时不得按系统弹窗处理。
     * @param selector - 系统弹窗标题控件。
     */
    info: async selector => {
      assert.deepEqual(selector, { res: 'android:id/alertTitle' });
      return { text: "com.ac.laiwanDev isn't responding" };
    },
    /** 任何点击都说明误吞了应用故障。 */
    tap: async () => assert.fail('不得关闭其他页面'),
  };
  await assert.rejects(waitForStagingNotice(device), error => error === failure);
  assert.equal(attempts, 3);
});

test('Pixel Launcher 无响应弹窗持续出现时有界失败', async context => {
  const failure = new Error('预发布确认框仍被遮挡');
  let attempts = 0;
  let dismissed = 0;
  context.mock.method(console, 'log', () => {});
  const device = {
    /** 模拟确认框始终被遮挡。 */
    wait: async () => { attempts++; throw failure; },
    /** 模拟系统桌面无响应弹窗始终存在。 */
    info: async () => ({ text: "Pixel Launcher isn't responding" }),
    /** 记录每次明确的系统弹窗关闭操作。 */
    tap: async () => { dismissed++; },
  };
  await assert.rejects(waitForStagingNotice(device), error => error === failure);
  assert.equal(attempts, 3);
  assert.equal(dismissed, 2);
});
