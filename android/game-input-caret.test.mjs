import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { loadGameFlow } from './game-flow-fixture.mjs';

const require = createRequire(import.meta.url);
const { focusedCaretMask } = loadGameFlow('./screenshot.ts', {
  pngjs: { PNG }, './scenarios': {}, './caret-mask': require('./caret-mask.ts'),
  'node:timers/promises': { /** 保留实际采样顺序，省去测试中的闪烁等待。 */ setTimeout: async () => {} },
});
const resource = 'report-pair-play-reason-input';
const text = 'Suspicious cooperation';
const input = { res: resource, focused: true, text, bounds: { x: 10, y: 10, width: 80, height: 60 } };

/** 运行真实光标差异算法，只替换设备输入与采样等待。
 * @param options - 可注入不闪烁和附件故障。
 */
function caretScene(options = {}) {
  const events = [], attachments = [];
  let checks = 0, screens = 0;
  const white = new PNG({ width: 100, height: 100 });
  white.data.fill(255);
  const blink = PNG.sync.read(PNG.sync.write(white));
  drawCaret(blink);
  const device = {
    /** 输入框首次尚未聚焦，后续返回已稳定目标。
     * @param selector - 必须精确限定目标输入框。
     */ info: async selector => {
      assert.equal(selector.res, resource);
      events.push('info');
      if (options.noInput && selector.focused) return undefined;
      return { ...input, focused: ++checks > 1 };
    },
    /** 键盘已经显示。
     * @param command - 键盘状态查询。
     */ shell: async command => { assert.equal(command, 'dumpsys input_method'); return Buffer.from('mInputShown=true'); },
    /** 只填写一次固定文字。
     * @param selector - 目标输入框。
     * @param value - 固定文字。
     */ fill: async (selector, value) => { assert.equal(selector.res, resource); assert.equal(value, text); events.push('fill'); },
    /** 返回真实 PNG 中细光标出现前后的像素。 */ screenshot: async () => {
      const after = screens++ > 0 && !options.noBlink;
      return PNG.sync.write(after ? blink : white);
    },
  };
  const { gameInputCaret } = loadGameFlow('./game-input-caret.ts', {
    '@playwright/test': require('@playwright/test'),
    './screenshot': { focusedCaretMask },
    './game-controls': {
      /** 单次聚焦输入框。 */ gameTap: async () => events.push('focus'),
      /** 键盘与焦点就绪后才等待最终布局。 */ gameTapTarget: async () => { events.push('stable'); assert.ok(checks > 1); },
    },
  });
  return { events, attachments,
    /** 使用生产流程要求真实光标，失败时尝试保存采样证据。 */ run: () => gameInputCaret(device, resource, text, {
      /** 保存原图和脱敏状态。
       * @param name - 附件名。
       * @param data - 附件内容。
       */ attach: async (name, data) => {
        if (options.attachFailure) throw new Error('report unavailable');
        attachments.push([name, data]);
      },
    }),
  };
}

/** 只绘制窄竖线，保持输入文字和边框像素不变。
 * @param picture - 实际 PNG 像素。
 */
function drawCaret(picture) {
  for (let y = 20; y < 50; y++) for (let x = 40; x < 43; x++) picture.data[(y * 100 + x) * 4] = 0;
}

test('明确聚焦、填写和等待布局后，检测精确目标输入框的真实细光标', async () => {
  const scene = caretScene();
  const caret = await scene.run();
  assert.deepEqual(scene.events.slice(0, 5), ['focus', 'fill', 'info', 'info', 'stable']);
  assert.equal(scene.events.filter(event => event === 'focus').length, 1);
  assert.equal(scene.events.filter(event => event === 'fill').length, 1);
  assert.deepEqual({ ...caret.mask, reason: undefined }, { x: 40, y: 20, width: 3, height: 30, reason: undefined });
});

test('没有真实闪烁时仍失败，保留两张原图但不记录输入文字', async () => {
  const scene = caretScene({ noBlink: true });
  await assert.rejects(scene.run(), /应检测到真实光标/);
  assert.deepEqual(scene.attachments.map(([name]) => name),
    [`${resource}-caret-state`, `${resource}-caret-before`, `${resource}-caret-after`]);
  assert.equal(scene.attachments[1][1].contentType, 'image/png');
  assert.equal(scene.attachments[0][1].body.includes(text), false);
});

test('光标诊断写入失败不覆盖原始检测错误，也不再次输入', async () => {
  const scene = caretScene({ noBlink: true, attachFailure: true });
  await assert.rejects(scene.run(), /应检测到真实光标/);
  assert.equal(scene.events.filter(event => event === 'fill').length, 1);
});

test('采样前失去焦点仍保留零次采样证据并抛出原检测错误', async () => {
  const scene = caretScene({ noInput: true });
  await assert.rejects(scene.run(), /应检测到真实光标/);
  assert.deepEqual(scene.attachments.map(([name]) => name), [`${resource}-caret-state`]);
  const state = JSON.parse(scene.attachments[0][1].body);
  assert.deepEqual(state.samples, []);
  assert.equal(JSON.stringify(state).includes(text), false);
  assert.equal(scene.events.filter(event => event === 'fill').length, 1);
});
