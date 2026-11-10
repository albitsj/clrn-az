import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { loadGameFlow } from './game-flow-fixture.mjs';

const require = createRequire(import.meta.url);
const { decodeSurfaceFrames, retainSurfaceFrames } = require('./surface-frame-images.ts');

/** 为判重创建无压缩像素差异。
 * @param value - RGB 通道值。
 */
function picture(value) {
  const png = new PNG({ width: 4, height: 3 });
  png.data.fill(value);
  for (let index = 3; index < png.data.length; index += 4) png.data[index] = 255;
  return PNG.sync.write(png);
}

test('只去掉连续完全相同帧，单像素差异也保留，并保留原始接收时间及末帧', () => {
  const images = Array.from({ length: 20 }, (_, index) => picture(index >= 8 && index < 12 ? 81 : 80));
  const frames = images.map((_, index) => ({ capturedAt: 100 + index * 17.3 }));
  const retained = retainSurfaceFrames(images, frames);
  assert.deepEqual(retained.map(frame => frame.capturedAt), [frames[0], frames[8], frames[12], frames[19]]
    .map(frame => frame.capturedAt));
  assert.deepEqual(retained[0].sampledAt, frames.map(frame => frame.capturedAt));
  assert.deepEqual(retained.map(frame => Buffer.from(frame.regions[0], 'base64')), [images[0], images[8], images[12], images[19]]);
});

test('采样不足或变化帧溢出必须失败，不能丢失不利画面后通过', () => {
  assert.throws(() => retainSurfaceFrames([picture(80)], [{ capturedAt: 1 }]), /不足 20 帧/);
  const images = Array.from({ length: 65 }, (_, index) => picture(index));
  assert.throws(() => retainSurfaceFrames(images, images.map((_, index) => ({ capturedAt: index }))), /64 帧/);
});

test('实际 ffmpeg 无时间补帧解码，保持帧数、顺序和完整 720×680 原始比较区域', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-surface-decode-test-'));
  const frames = Array.from({ length: 3 }, (_, index) => ({ capturedAt: 100 + index * 57,
    rgb: Buffer.alloc(240 * 426 * 3, index * 60) }));
  try {
    const images = decodeSurfaceFrames(directory, frames, { x: 0, y: 500, width: 720, height: 680 });
    assert.equal(images.length, 3);
    for (const [index, image] of images.entries()) {
      const png = PNG.sync.read(image);
      assert.equal(png.width, 720);
      assert.equal(png.height, 680);
      assert.equal(png.data[0], index * 60);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('仅 Slot 退出选择原始采帧，保留原 ROI、报告及单次入口', async () => {
  const bounds = { x: 0, y: 500, width: 720, height: 680 };
  const context = { device: {}, name: 'slot-popup-exit', region: bounds, info: {},
    /** 路由测试不执行设备操作。 */ trigger: () => {} };
  const expected = [{ capturedAt: 108.2, png: 'real-png' }];
  /** 正式调用方显式传入的默认录屏器，不能因此错过原始帧路径。 */
  const recordNativeVideoFrames = () => { throw new Error('不应回到 MP4 编码路径'); };
  const { recordTransitionFrames } = loadGameFlow('./transition-frames.ts', {
    './native-sampling': {}, './video-frames': { recordNativeVideoFrames }, './screenshot': {},
    './surface-frame-images': {
      /** 仅替换外部采集边界，验证精确路由与上下文。
       * @param request - 传给采帧器的真实参数。
       */
      recordSurfaceRegion: async request => { assert.deepEqual(request, { ...context, bounds }); return expected; },
    },
  });
  assert.equal(await recordTransitionFrames(context), expected);
  assert.equal(await recordTransitionFrames(context, recordNativeVideoFrames), expected);
});
