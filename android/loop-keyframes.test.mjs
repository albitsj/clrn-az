import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { captureLoopKeyframes, captureMovingKeyframes } = require('./loop-keyframes.ts');
const region = { x: 0, y: 0, width: 4, height: 4 };

/** 构造明暗不同、完整不透明的原生 PNG。
 * @param level - RGB 灰度。
 */
function picture(level) {
  const png = new PNG({ width: 4, height: 4 });
  png.data.fill(255);
  for (let offset = 0; offset < png.data.length; offset += 4) png.data.fill(level, offset, offset + 3);
  return PNG.sync.write(png);
}
const dark = picture(0), light = picture(255);

/** 只替换设备采样边界，使用实际颜色算法及基准文件。
 * @param context - 清理临时文件的测试上下文。
 * @param name - 循环名称。
 * @param windows - 连续原生采样窗口。
 */
function scene(context, name, windows) {
  const directory = mkdtempSync(join(tmpdir(), 'loop-keyframes-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [phase, bytes] of [['dark', dark], ['light', light], ['first', dark], ['moved', light]]) {
    writeFileSync(join(directory, `${name}-1-${phase}.png`), bytes);
  }
  let samples = 0;
  const attachments = new Map();
  const device = { _connection: { /** 提供本场景的真实采样协议。 */ toImpl: () => ({
    /** 每次请求消耗一个固定窗口。
     * @param method - 原生采样命令。
     */
    _send: async method => {
      assert.equal(method, 'motionFrames');
      assert.ok(samples < windows.length, '不能扩大采样次数');
      return windows[samples++].map((png, index) => ({ capturedAt: index * 100, png: png.toString('base64') }));
    },
  }) } };
  const info = { config: { updateSnapshots: 'none' },
    /** 保存诊断供断言。
     * @param name - 附件名。
     * @param data - 原始附件。
     */
    attach: async (name, data) => attachments.set(name, data.body),
    /** 定位独立临时参考。
     * @param file - 既有基准名。
     */
    snapshotPath: file => join(directory, file),
  };
  return { device, info, attachments, /** 读取实际采样窗口数。 */ sampleCount: () => samples };
}

test('脉动先静止再变化，跨窗口选择真实明暗相位且保留完整时间线', async context => {
  const current = scene(context, 'pulse', [Array(10).fill(dark), [light, ...Array(9).fill(dark)]]);
  await captureLoopKeyframes(current.device, 'pulse', current.info, [region], 2);
  assert.equal(current.sampleCount(), 2);
  assert.equal(JSON.parse(current.attachments.get('pulse-timeline')).length, 20);
  const phases = JSON.parse(current.attachments.get('pulse-1-phases'));
  assert.deepEqual(phases, { dark: 0, light: 10, delta: 255 });
});

test('默认移动采样只取一个窗口，保留首帧和最远相位的基准检查', async context => {
  const current = scene(context, 'moving', [[dark, light, ...Array(8).fill(dark)]]);
  await captureMovingKeyframes(current.device, 'moving', current.info, [region]);
  assert.equal(current.sampleCount(), 1);
  assert.deepEqual(current.attachments.get('moving-1-first.png'), dark);
  assert.deepEqual(current.attachments.get('moving-1-moved.png'), light);
});

for (const [name, capture, message] of [['pulse', captureLoopKeyframes, /必须脉动/],
  ['moving', captureMovingKeyframes, /必须运动/]]) {
  test(`${name} 静止画面不能冒充循环动画，也不能扩大默认采样次数`, async context => {
    const current = scene(context, name, [Array(10).fill(dark)]);
    await assert.rejects(capture(current.device, name, current.info, [region]), message);
    assert.equal(current.sampleCount(), 1);
  });
}
