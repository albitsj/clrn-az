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
