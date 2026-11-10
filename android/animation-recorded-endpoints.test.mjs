/** 真实录制首尾的缩放色差不能冒充动画中途相位，已审查相位仍须通过。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { middleCandidates, assertReviewedVideoMiddle } = require('./animation-transition.ts');
const folder = new URL('./fixtures/card-rank-source-endpoints/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('source.json', folder), 'utf8'));
const images = Object.fromEntries(Object.entries(source.images).map(([name, information]) => {
  const bytes = readFileSync(new URL(name, folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), information.sha256);
  return [name, bytes];
}));
const references = ['middle', 'late-phase'].map(phase => readFileSync(new URL(
  `./snapshots/android-35-x86_64-720x1280-en/${source.name}-${phase}.png`, import.meta.url)));

for (const [name, phases] of [
  ['只有真实录制端点时，缩放色差不能冒充动画', ['recorded-first.png', 'recorded-penultimate.png', 'recorded-last.png']],
  ['牌型面板已消失而只有背景遮罩淡出时必须拒绝', ['recorded-first.png', 'backdrop-only.png', 'recorded-last.png']],
]) test(name, () => {
  const frames = phases.map(phase => images[phase]);
  const candidates = middleCandidates(images['before.png'], images['after.png'], frames, 'videoFrames');
  assert.throws(() => assertReviewedVideoMiddle(images['before.png'], images['after.png'], candidates, references),
    /动画中途帧的实际画面须接近已审查轨迹/);
});

test('在同一录制端点之间加入原有已审查相位，保持原始空间门禁', () => {
  const frames = [images['recorded-first.png'], references[0], images['recorded-last.png']];
  const candidates = middleCandidates(images['before.png'], images['after.png'], frames, 'videoFrames');
  assert.ok(candidates.length >= 1);
  assertReviewedVideoMiddle(images['before.png'], images['after.png'], candidates, references);
});

