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

for (const [name, bounds] of [
  ['slot-popup-exit', { x: 0, y: 500, width: 720, height: 680 }],
  ['texas-holdem-card-rank-exit', { x: 110, y: 400, width: 440, height: 600 }],
  ['texas-preflop-cards', { x: 360, y: 1054, width: 137, height: 102 }],
  ['texas-river-cards', { x: 492, y: 603, width: 78, height: 117 }],
]) {
  test(`${name} uses complete raw frames with the original ROI and default-recorder identity`, async () => {
    const context = { device: {}, name, region: bounds, info: {},
      /** The routing boundary must not perform a device operation. */ trigger: () => {} };
    const expected = [{ capturedAt: 108.2, png: 'real-png' }];
    /** Encoding cannot supply the missing physical animation phase. */
    const recordNativeVideoFrames = () => { throw new Error('unexpected MP4 path'); };
    const { recordTransitionFrames } = loadGameFlow('./transition-frames.ts', {
      './native-sampling': {}, './video-frames': { recordNativeVideoFrames }, './screenshot': {},
      './surface-frame-images': {
        /** Preserve the exact capture parameters and original bounds.
         * @param request - Physical source capture context.
         */
        recordSurfaceRegion: async request => { assert.deepEqual(request, { ...context, bounds }); return expected; },
      },
    });
    assert.equal(await recordTransitionFrames(context), expected);
    assert.equal(await recordTransitionFrames(context, recordNativeVideoFrames), expected);
  });
}
