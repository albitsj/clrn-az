/** 横滑面板要沿运动轴区分持续背景，不能把仍可见的前景当作背景要求。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { assertReviewedVideoMiddle, middleCandidates } = require('./animation-transition.ts');
const { reviewedVideoAxis } = require('./video-motion.ts');
const folder = new URL('./fixtures/zha-horizontal-phases/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('source.json', folder), 'utf8'));
for (const record of source.records) {
  const images = Object.fromEntries(Object.entries(record.images).map(([phase, image]) => {
    const bytes = readFileSync(new URL(image.file, folder));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
    return [phase, bytes];
  }));
  const anchor = readFileSync(new URL(`./snapshots/android-35-x86_64-720x1280-en/${record.name}-middle.png`, import.meta.url));
  /** 使用同一生产门禁及场景方向，不新增参考图或改动门槛。
   * @param frame - 原始相位或明确标识的反例。
   * @param axis - 产品已确认的运动轴。
   */
  const compare = (frame, axis = reviewedVideoAxis(record.name)) => assertReviewedVideoMiddle(images.before,
    images.after, middleCandidates(images.before, images.after, [frame], 'videoFrames'), [anchor], axis);

  test(`${record.name} 的真实可见前景不能被整列背景检查误拒`, () => {
    assert.throws(() => compare(images.middle, 'vertical'), /动画中途帧的实际画面须接近已审查轨迹/);
    compare(images.middle);
  });

  for (const dy of [-80, 80]) test(`${record.name} 仍拒绝错轴 ${dy} 像素`, () => {
    const from = PNG.sync.read(images.middle), to = PNG.sync.read(images.after);
    PNG.bitblt(from, to, 0, Math.max(0, -dy), from.width, from.height - Math.abs(dy), 0, Math.max(0, dy));
    assert.throws(() => compare(PNG.sync.write(to)), /动画中途帧的实际画面须接近已审查轨迹/);
  });

  test(`${record.name} 不能将原生终点当作中途前景`, () => {
    assert.throws(() => compare(images.after), /必须采到起点和终点之间的真实动画帧/);
  });
}
