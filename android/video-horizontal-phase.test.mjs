/** 真实左滑不能被当成横向错位；背景、反向及纵向布局错误仍必须阻塞。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { captureNativeTransition, assertReviewedVideoMiddle, middleCandidates } = require('./animation-transition.ts');
const folder = new URL('./fixtures/card-rank-horizontal-phase/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('source.json', folder), 'utf8'));
const images = Object.fromEntries(Object.entries(source.images).map(([name, record]) => {
  const bytes = readFileSync(new URL(name, folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
  return [name, bytes];
}));
const snapshots = fileURLToPath(new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url));
const anchors = ['middle', 'late-phase'].map(phase => readFileSync(path.join(snapshots, `${source.name}-${phase}.png`)));

/** 保留所有原有门槛，只声明组件本来使用的横向退场。
 * @param frame - 原始录制相位或明确标识的合成反例。
 */
function compare(frame) {
  const frames = [images['before.png'], frame, images['after.png']];
  return assertReviewedVideoMiddle(images['before.png'], images['after.png'],
    middleCandidates(images['before.png'], images['after.png'], frames, 'videoFrames'), anchors, 'horizontal');
}

/** 仅用已有真实首尾背景构造错轴反例，不将合成图用作正向参考。
 * @param frame - 要验证错位的原始相位。
 * @param dx - 横向位移。
 * @param dy - 纵向位移。
 */
function shifted(frame, dx, dy) {
  const from = PNG.sync.read(frame), to = PNG.sync.read(images['after.png']);
  const sx = Math.max(0, -dx), sy = Math.max(0, -dy);
  PNG.bitblt(from, to, sx, sy, from.width - Math.abs(dx), from.height - Math.abs(dy),
    Math.max(0, dx), Math.max(0, dy));
  return PNG.sync.write(to);
}

/** 为生产设备边界还原真实局部原图，外部画布不参与裁切后的比较。
 * @param bytes - 原始局部 PNG。
 */
function fullScreen(bytes) {
  const crop = PNG.sync.read(bytes), full = new PNG({ width: 720, height: 1280 });
  PNG.bitblt(crop, full, 0, 0, crop.width, crop.height, source.region.x, source.region.y);
  return PNG.sync.write(full).toString('base64');
}

test('真实首败中的左滑面板保留原色差及前景门槛后应通过', () => compare(images['middle.png']));

test('完整生产采集入口按原场景声明左滑方向，不能只在宿主调用中放行', async () => {
  let triggered = false;
  const frames = [images['before.png'], images['middle.png'], images['after.png']];
  const device = { _connection: {
    /** 仅替换外部设备连接。 */
    toImpl: () => ({
      /** 还原同一次录制的真实首尾截图。 */
      _send: async () => fullScreen(triggered ? frames[2] : frames[0]),
    }),
  } };
  const info = { config: { updateSnapshots: 'none' },
    /** 保留原采集路径的附件边界。 */
    attach: async () => {},
    /** 返回原有正式参考路径。
     * @param name - 原有截图名。
     */
    snapshotPath: name => path.join(snapshots, name),
  };
  await captureNativeTransition(device, source.name, info, source.region, () => { triggered = true; },
    [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [],
    /** 返回已核对原始帧，不改变触发次数。
     * @param _name - 原场景名。
     * @param _region - 原裁切范围。
     * @param trigger - 原入口触发器。
     */
    async (_name, _region, trigger) => {
      assert.equal(triggered, false);
      await trigger();
      assert.equal(triggered, true);
      return frames;
    });
  assert.equal(triggered, true);
});

for (const dy of [-80, -40, 40, 80]) test(`左滑场景仍拒绝纵向错位 ${dy} 像素`, () => {
  assert.throws(() => compare(shifted(images['middle.png'], 0, dy)), /动画中途帧的实际画面须接近已审查轨迹/);
});
for (const dx of [40, 80, 160]) test(`左滑场景不能误收向右离开的面板 ${dx} 像素`, () => {
  assert.throws(() => compare(shifted(images['before.png'], dx, 0)), /动画中途帧的实际画面须接近已审查轨迹/);
});

test('左滑方向不能放行面板消失后的真实背景渐变反例', () => {
  const frame = readFileSync(new URL('./fixtures/card-rank-source-endpoints/backdrop-only.png', import.meta.url));
  assert.throws(() => compare(frame), /动画中途帧的实际画面须接近已审查轨迹/);
});

for (const axis of ['horizontal', 'vertical']) test(`左滑不能放行 ${axis} 镜像内容`, () => {
  const original = PNG.sync.read(images['middle.png']);
  const flipped = new PNG({ width: original.width, height: original.height });
  for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
    const sx = axis === 'horizontal' ? original.width - 1 - x : x;
    const sy = axis === 'vertical' ? original.height - 1 - y : y;
    original.data.copy(flipped.data, (y * original.width + x) * 4, (sy * original.width + sx) * 4,
      (sy * original.width + sx) * 4 + 4);
  }
  assert.throws(() => compare(PNG.sync.write(flipped)), /动画中途帧的实际画面须接近已审查轨迹/);
});
