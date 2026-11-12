import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { captureNativeTransition } = require('./animation-transition.ts');

const directory = new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url);
const name = 'club-more-enter';
const start = readFileSync(new URL(`${name}-start.png`, directory));
const middle = readFileSync(new URL(`${name}-middle.png`, directory));
const end = readFileSync(new URL(`${name}-end.png`, directory));
const { width, height } = PNG.sync.read(start);

/** 使用原生转场完整比较路径检查诊断，不启动设备。
 * @param frames - 已审查帧。
 * @param scene - 诊断时钟与附件观察器。
 */
async function compare(frames, scene) {
  let screens = 0;
  const device = { _connection: { /** 提供原生命令。 */ toImpl: () => ({
    /** 返回原截图或采样，不改变画面。
     * @param method - 原生命令。
     */ _send: async method => method === 'screen'
      ? (screens++ === 0 ? start : end).toString('base64')
      : frames.map((png, index) => ({ capturedAt: index * 100, capturedAtEpochMs: frameEpoch(scene, index),
        png: png.toString('base64') })),
  }) } };
  const info = { attach: scene.attach, config: { updateSnapshots: 'none' },
    /** 返回正式基准。
     * @param file - 图片名称。
     */ snapshotPath: file => new URL(file, directory).pathname };
  await captureNativeTransition(device, name, info, { x: 0, y: 0, width, height }, () => {}, [], [], 0);
}

test('设备墙钟诊断保留原始采样时间，不记录 PNG 或业务数据', async () => {
  const clocks = [1700000000000, 1700000000100, 1700000000200];
  let observed;
  await compare([start, middle, end], { name, start, end, width, height, epochTimes: clocks,
    /** 检查与原采样帧一一对应的两个时钟。
     * @param label - 附件名称。
     * @param data - 脱敏附件。
     */ attach: async (label, data) => {
      if (label.endsWith('-device-clock')) observed = JSON.parse(data.body);
    },
  });
  assert.deepEqual(observed, clocks.map((capturedAtEpochMs, index) => ({ capturedAt: index * 100, capturedAtEpochMs })));
});

test('设备墙钟诊断写入失败仍保留原动画断言失败', async () => {
  await assert.rejects(compare([start, start, end], { name, start, end, width, height,
    /** 模拟新增诊断附件故障。
     * @param label - 附件名称。
     */ attach: async label => {
      if (label.endsWith('-device-clock')) throw new Error('diagnostic failure');
    },
  }), /必须采到起点和终点之间的真实动画帧/);
});

/** 读取模拟驱动的可选设备时间。
 * @param scene - 当前转场。
 * @param index - 帧序号。
 */
function frameEpoch(scene, index) { return scene.epochTimes?.[index]; }

