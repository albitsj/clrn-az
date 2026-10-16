import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { motionParts } = require('./motion-regions.ts');
const { changedMotionRegions } = require('./loop-animation.ts');

/**
 * 构造两个动画区和一个非动画区的真实 PNG 像素分区。
 * @param left - 左侧动画灰度。
 * @param right - 右侧动画灰度。
 * @param outside - 非动画区域灰度。
 */
function parts(left, right, outside = 0) {
  const png = new PNG({ width: 6, height: 2 });
  for (let y = 0; y < 2; y++) for (let x = 0; x < 6; x++) {
    const offset = (y * 6 + x) * 4;
    png.data.fill(x < 2 ? left : x < 4 ? right : outside, offset, offset + 3);
    png.data[offset + 3] = 255;
  }
  return motionParts(PNG.sync.write(png), [
    { x: 0, y: 0, width: 2, height: 2 }, { x: 2, y: 0, width: 2, height: 2 },
  ]).regions;
}

test('背景变化不能冒充动画，且每个目标区分别验证', () => {
  const first = parts(0, 0);
  assert.deepEqual(changedMotionRegions(first, parts(0, 0, 255)), [false, false]);
  assert.deepEqual(changedMotionRegions(first, parts(255, 0)), [true, false]);
  assert.deepEqual(changedMotionRegions(first, parts(0, 255)), [false, true]);
  assert.throws(() => changedMotionRegions(first, parts(0, 0).slice(0, 1)), /数量/);
});
