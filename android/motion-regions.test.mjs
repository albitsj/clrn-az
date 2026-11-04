import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
const require = createRequire(import.meta.url);
const { motionParts, samePixels } = require('./motion-regions.ts');
const configuration = require('./playwright.config.ts').default;
const comparator = require('playwright-core/lib/coreBundle').utils.getComparator('image/png');
const regions = [{ x: 0, y: 0, width: 4, height: 4 }, { x: 4, y: 0, width: 4, height: 4 }];

/**
 * 构造两个独立动画区域和一个静态下半屏，用明显色差验证没有漏比较的像素。
 * @param left - 左侧动画灰度。
 * @param right - 右侧动画灰度。
 * @param outside - 静态区域灰度。
 */
function frame(left, right, outside = 255) {
  const picture = new PNG({ width: 8, height: 8 });
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const offset = (y * 8 + x) * 4;
    picture.data.fill(y < 4 ? x < 4 ? left : right : outside, offset, offset + 3);
    picture.data[offset + 3] = 255;
  }
  return PNG.sync.write(picture);
}

test('独立闪烁可分时匹配，静态区域和每个玩家区域都不能漏掉', () => {
  const expected = motionParts(frame(0, 255), regions);
  const first = motionParts(frame(0, 0), regions);
  const second = motionParts(frame(255, 255), regions);
  assert.equal(samePixels(first.outside, expected.outside), true);
  assert.equal(samePixels(first.regions[0], expected.regions[0]), true);
  assert.equal(samePixels(first.regions[1], expected.regions[1]), false);
  assert.equal(samePixels(second.regions[1], expected.regions[1]), true);
  const badPlayer = motionParts(frame(0, 80), regions);
  assert.equal(samePixels(badPlayer.regions[1], expected.regions[1]), false);
  const badOutside = motionParts(frame(0, 255, 0), regions);
  assert.equal(samePixels(badOutside.outside, expected.outside), false);
});

test('动画分区不能重叠或越界，完整帧尺寸变化仍导致失败', () => {
  assert.throws(() => motionParts(frame(0, 255), [regions[0], regions[0]]), /不能重叠/);
  assert.throws(() => motionParts(frame(0, 255), [{ x: 7, y: 7, width: 2, height: 2 }]), /超出/);
  assert.equal(samePixels(frame(0, 255), PNG.sync.write(new PNG({ width: 9, height: 8 }))), false);
});

test('稳定和基准比较保留颜色容差，小分区的一个有效差异像素仍超过比例', () => {
  const expected = frame(80, 80, 80);
  assert.equal(samePixels(frame(81, 81, 81), expected), true);
  const changed = PNG.sync.read(expected);
  changed.data.fill(255, (4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 3);
  assert.equal(samePixels(PNG.sync.write(changed), expected), false);
});

/**
 * 在白色截图内加入指定数量的黑色像素，避开抗锯齿和颜色容差边界。
 * @param count - 有效差异像素数。
 * @param width - 整张截图宽度。
 */
function changedPixels(count, width = 100) {
  const picture = new PNG({ width, height: 100 });
  picture.data.fill(255);
  for (let index = 0; index < count; index++) {
    const offset = ((50 + Math.floor(index / 10)) * width + 20 + index % 10) * 4;
    picture.data.fill(0, offset, offset + 3);
  }
  return PNG.sync.write(picture);
}

test('整图最终比较与稳定性判断均允许百分之零点五，超过一个像素就失败', () => {
  const expected = changedPixels(0);
  for (const [count, passes] of [[50, true], [51, false]]) {
    const actual = changedPixels(count);
    assert.equal(comparator(actual, expected, configuration.expect.toMatchSnapshot) === null, passes,
      `一万像素中有 ${count} 个有效差异时，最终比较须使用约定比例`);
    assert.equal(samePixels(actual, expected), passes,
      `一万像素中有 ${count} 个有效差异时，稳定性判断须与最终比较一致`);
  }
});

test('局部图和动画之外的补集按各自一万像素计算，不借用其他分区面积', () => {
  const region = [{ x: 100, y: 0, width: 100, height: 100 }];
  const expected = motionParts(changedPixels(0, 200), region);
  const left = [{ x: 0, y: 0, width: 100, height: 100 }];
  const expectedCrop = motionParts(changedPixels(0, 200), left).regions[0];
  for (const [count, passes] of [[50, true], [51, false]]) {
    const actual = changedPixels(count, 200);
    assert.equal(samePixels(motionParts(actual, left).regions[0], expectedCrop), passes,
      '局部图以实际裁切面积核算差异');
    assert.equal(samePixels(motionParts(actual, region).outside, expected.outside), passes,
      '补集以排除独立动画分区后的面积核算差异');
  }
});

test('差异比例不放行尺寸变化或无效基准', () => {
  assert.equal(comparator(changedPixels(0, 101), changedPixels(0),
    configuration.expect.toMatchSnapshot) === null, false, '尺寸不符必须失败');
  assert.equal(samePixels(changedPixels(0, 101), changedPixels(0)), false, '稳定性比较也拒绝尺寸变化');
  assert.throws(() => samePixels(changedPixels(0), Buffer.from('无效图片')), '无效基准不能视为匹配');
});
