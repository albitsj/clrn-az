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

test('上一场景的 timeout / OK 对话框隐藏拉霸控件时，先确认再关闭拉霸并返回标签', async () => {
  let screen = 'dialog';
  const actions = [];
  const visibleByScreen = { dialog: ['android:id/message', 'android:id/button1'],
    slot: ['slot-machine-view', 'close-button'], tabs: [] };
  const device = {
    /** 回放首败层级：Dialog 打开时，底下的拉霸不在可访问树中。
     * @param selector - 原生查询。
     */
    info: async selector => {
      const visible = visibleByScreen[screen];
      if (!visible.includes(selector.res)) throw new Error('java.lang.NullPointerException');
      return { bounds };
    },
    /** 标签只能在确认对话框并关闭拉霸后出现。
     * @param selector - 等待目标。
     */
    wait: async selector => {
      if (selector.res === 'settings-tab') assert.equal(screen, 'tabs');
    },
    /** 精确匹配本轮原生按钮，不能用 Back 关闭不可取消的 Dialog。
     * @param selector - 点击目标。
     */
    tap: async selector => {
      assert.deepEqual(selector, { res: 'android:id/button1', text: 'OK' });
      actions.push('OK'); screen = 'slot';
    },
    input: {
      /** 拉霸关闭入口仍使用既有真实点击。 */
      tap: async () => { assert.equal(screen, 'slot'); actions.push('close-slot'); screen = 'tabs'; },
      /** 本轮 Back 对 Dialog 无效，不应走该路径。 */
      press: async () => { assert.fail('不能用 Back 代替对话框确认'); },
    },
  };
  await returnToTabs(device);
  assert.deepEqual(actions, ['OK', 'close-slot']);
});

test('不确认其他消息或 RETRY 对话框，仍耗尽原有标签查询并抛出原始失败', async () => {
  for (const [message, button] of [['other error', 'OK'], ['timeout', 'RETRY']]) {
    const failure = new Error('标签被未知 Dialog 遮挡');
    let waits = 0;
    let backs = 0;
    const device = {
      /** 只暴露匹配文字的原生 Dialog 节点。
       * @param selector - 原生查询。
       */
      info: async selector => {
        const text = { 'android:id/message': message, 'android:id/button1': button }[selector.res];
        if (text === undefined || selector.text !== text) throw new Error('java.lang.NullPointerException');
        return { bounds };
      },
      /** 未知 Dialog 必须继续阻塞标签。
       * @param selector - 等待目标。
       * @param options - 原有等待预算。
       */
      wait: async (selector, options) => {
        assert.equal(selector.res, 'settings-tab'); assert.equal(options.timeout, 3000);
        waits++; throw failure;
      },
      /** 不允许盲目确认其他错误。 */
      tap: async () => { assert.fail('未知 Dialog 不应被确认'); },
      input: {
        /** 保留原有的 Back 次数。 */
        press: async () => { backs++; },
      },
    };
    await assert.rejects(returnToTabs(device), error => error === failure);
    assert.equal(waits, 9);
    assert.equal(backs, 8);
  }
});
