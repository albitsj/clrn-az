import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { recordTransitionFrames } = require('./transition-frames.ts');
const { sampleNativeFrames } = require('./native-sampling.ts');
const bounds = { x: 0, y: 500, width: 720, height: 680 };
const images = ['start', 'middle', 'end'].map(phase => readFileSync(new URL(
  `./snapshots/android-35-x86_64-720x1280-en/slot-popup-exit-${phase}.png`, import.meta.url)));

for (const name of ['slot-popup-exit', 'texas-holdem-chat-enter', 'texas-holdem-chat-exit']) {
  test(`${name} 保留原区域、真实时间戳与所有无损帧，实际点击只发生一次`, async () => {
    const attachments = new Map();
    let triggers = 0;
    const raw = images.map((png, index) => ({ capturedAt: 1000 + index * 50,
      regions: [png.toString('base64')] }));
    const device = { _connection: { /** 返回当前测试设备连接。 */ toImpl: () => ({
      /** 确认实际原生协议，而不是在采集前后拼接画面。
       * @param method - 设备命令。
       * @param params - 原始比较区域。
       */
      _send: async (method, params) => { assert.equal(method, 'panelFrames');
        assert.deepEqual(params, { regions: [bounds] }); return raw; },
    }) } };
    const info = { /** 保留当前采样附件。
     * @param name - 附件名。
     * @param value - 附件内容。
     */ attach: async (name, value) => attachments.set(name, value.body) };
    const frames = await recordTransitionFrames({ device, name, region: bounds,
      /** 只记录一次真实入口触发。 */ trigger: () => { triggers++; }, info });
    assert.equal(triggers, 1);
    assert.deepEqual(frames.map(frame => frame.capturedAt), [1000, 1050, 1100]);
    assert.deepEqual(frames.map(frame => Buffer.from(frame.png, 'base64')), images);
    const metadata = JSON.parse(attachments.get(`${name}-native-sampling`));
    assert.deepEqual(metadata, { method: 'panelFrames', regions: [bounds], capturedAt: [1000, 1050, 1100] });
    assert.deepEqual(attachments.get(`${name}-native-frame-0001.png`), images[1]);
  });
}

test('显式录制边界仍可重放原始录屏，既有空间错位和闪屏反证继续执行原路径', async () => {
  const device = { _connection: { /** 返回当前测试设备连接。 */ toImpl: () => { throw new Error('不能访问原生设备'); } } };
  const frames = await recordTransitionFrames({ device, name: 'slot-popup-exit', region: bounds,
    /** 重放时不操作设备。 */ trigger: () => {}, info: {} }, async () => images);
  assert.deepEqual(frames.map(frame => frame.capturedAt), [0, 33, 66]);
});

for (const failure of ['driver', 'deadline']) {
  test(`${failure} 失败后不再点击真实入口，也不留下未处理的异步拒绝`, async () => {
    let triggers = 0;
    const original = new Error('native driver unavailable');
    const connection = { /** 模拟设备不可用或永不返回。 */ _send: async () => {
      if (failure === 'driver') throw original;
      return new Promise(() => {});
    } };
    await assert.rejects(sampleNativeFrames(connection, { name: 'panel', method: 'panelFrames', timeoutMs: 10,
      /** 失败后不能发生的真实操作。 */ trigger: () => { triggers++; } }), failure === 'driver' ? original : /原生采集超时/);
    await setTimeout(350);
    assert.equal(triggers, 0);
  });
}
