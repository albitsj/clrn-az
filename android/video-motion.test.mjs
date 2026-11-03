/** 缩放前景不能充当持续背景，但未变化的列仍不能冒充背景淡入。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { preservesVideoColumns } = require('./video-motion.ts');

/** 生成背景变暗、中央矩形缩放的缩略图，不依赖任何正式截图。
 * @param background - 背景灰度。
 * @param inset - 矩形距离左右边缘的像素。
 * @param top - 矩形顶部。
 */
function panel(background, inset, top) {
  const width = 8, height = 8;
  const pixels = new Uint8Array(width * height * 3).fill(background);
  for (let y = top; y < height; y++) for (let x = inset; x < width - inset; x++) {
    pixels.fill(20, (y * width + x) * 3, (y * width + x + 1) * 3);
  }
  return { pixels, width, height };
}

const before = panel(100, 4, 8);
const reference = panel(95, 2, 2);
const after = panel(90, 1, 1);

test('较小的合法缩放相位无须覆盖较大参考相位的前景边缘', () => {
  assert.equal(preservesVideoColumns([before, after], reference, panel(95, 3, 4)), true);
});

for (const noise of [-1, 0, 1]) {
  test(`背景边缘仍为起点、仅有 ${noise} 编码色差时拒绝`, () => {
    const frame = panel(95, 3, 4);
    // 模拟横移后露出的整列起点，内部面板与其他列保持合法运动。
    for (let y = 0; y < frame.height; y++) frame.pixels.fill(100 + noise, y * 24, y * 24 + 3);
    assert.equal(preservesVideoColumns([before, after], reference, frame), false);
  });
}
