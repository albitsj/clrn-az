import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import childProcess from 'node:child_process';
const require = createRequire(import.meta.url);
const { returnToTabs, reveal } = require('./navigation.ts');
const bounds = { x: 20, y: 100, width: 100, height: 50 };

/** 为真实导航模块隔离 adb，仍核对专用模拟器参数。
 * @param context - 当前测试上下文。
 * @param onAdb - 对真实原生命令的观察器。
 */
function mockAdb(context, onAdb) {
  const original = process.env.ANDROID_SERIAL;
  process.env.ANDROID_SERIAL = 'emulator-5554';
  context.after(() => {
    if (original === undefined) delete process.env.ANDROID_SERIAL;
    else process.env.ANDROID_SERIAL = original;
  });
  context.mock.method(childProcess, 'execFileSync', (command, args) => {
    assert.equal(command, 'adb');
    assert.deepEqual(args.slice(0, 2), ['-s', 'emulator-5554']);
    return onAdb(args.slice(2));
  });
}

test('返回标签按既有优先级正常关闭引导、拉霸、确认框、选玩法及建房，不点击遮罩下标签', async context => {
  const overlays = ['stepDescription', 'slot-machine-view', 'confirm-pop-up-image-background',
    'select-game-category-text', 'base-create-room-screen'];
  const closed = [];
  /** 记录每个浮层确实经过正常关闭入口。 */
  const close = () => { closed.push(overlays.shift()); };
  mockAdb(context, args => { assert.deepEqual(args.slice(0, 3), ['shell', 'input', 'tap']); close(); return ''; });
  const device = {
    /** 只有正常清理完浮层后才允许查询底部标签。
     * @param selector - 等待目标。
     */
    wait: async selector => {
      if (selector.res === 'settings-tab') assert.equal(overlays.length, 0);
    },
    /** 返回真实存在的浮层和点击控件，空节点沿用驱动错误。
     * @param selector - 查询目标。
     */
    info: async selector => {
      const available = [...overlays, 'tooltip-finish-button', 'tooltip-next-button', 'close-button', 'cancel-button'];
      if (!available.includes(selector.res)) throw new Error('java.lang.NullPointerException');
      return { bounds };
    },
    input: {
      /** 正常点击浮层内按钮。 */
      tap: async () => close(),
      /** 建房页面通过 Back 卸载。
       * @param key - 原生按键。
       */
      press: async key => { assert.equal(key, 'Back'); close(); },
    },
  };
  await returnToTabs(device);
  assert.deepEqual(closed, ['stepDescription', 'slot-machine-view', 'confirm-pop-up-image-background',
    'select-game-category-text', 'base-create-room-screen']);
});

test('reveal 最后一次失败保留原始错误，九次查询只执行八次滚动且不延长时限', async context => {
  const failure = new Error('目标始终不可见');
  const waits = [];
  const swipes = [];
  mockAdb(context, args => {
    if (args[1] === 'input') swipes.push(args);
    return 'mInputShown=false';
  });
  const device = {
    /** 每次等待均失败，记录原有的首轮与后续时限。
     * @param selector - 等待目标。
     * @param options - 查询时限。
     */
    wait: async (selector, options) => { assert.deepEqual(selector, { res: 'missing' }); waits.push(options.timeout); throw failure; },
    /** 只提供纵向容器，引导查询仍为空。
     * @param selector - 查询目标。
     */
    info: async selector => {
      if (!selector.scrollable) throw new Error('java.lang.NullPointerException');
      assert.equal(selector.clazz, 'android.widget.ScrollView');
      return { bounds };
    },
  };
  await assert.rejects(reveal(device, { res: 'missing' }, true), error => error === failure);
  assert.deepEqual(waits, [7000, ...Array(8).fill(3000)]);
  assert.equal(swipes.length, 8);
  assert.ok(swipes.every(args => args.at(-1) === '600'));
});
