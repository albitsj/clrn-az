import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { assertReviewedVideoMiddle, captureNativeTransition, middleCandidates } =
  require('./animation-transition.ts');
const snapshots = fileURLToPath(new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url));
const name = 'club-more-enter';
const start = readFileSync(`${snapshots}${name}-start.png`);
const middle = readFileSync(`${snapshots}${name}-middle.png`);
const end = readFileSync(`${snapshots}${name}-end.png`);
const { width, height } = PNG.sync.read(start);

/**
 * 用真实已审查截图模拟原生驱动，保留完整的采样与基准比较流程。
 * @param frames - 原生驱动返回的时间线。
 */
async function compare(frames) {
  let screens = 0;
  const device = { _connection: { /** 返回本例的模拟原生驱动。 */ toImpl: () => ({
    /** 按驱动命令返回屏幕或连续帧。
     * @param method - 原生驱动命令。
     */
    _send: async method => method === 'screen'
      ? (screens++ === 0 ? start : end).toString('base64')
      : frames.map((png, index) => ({ capturedAt: index * 100, png: png.toString('base64') })),
  }) } };
  const info = { /** 测试无需保留附件。 */ attach: async () => {}, config: { updateSnapshots: 'none' },
    /** 映射到已审查的本地基准。
     * @param file - 基准文件名。
     */
    snapshotPath: file => `${snapshots}${file}` };
  await captureNativeTransition(device, name, info, { x: 0, y: 0, width, height }, () => {});
}

test('真实俱乐部菜单中途关键帧通过转场视觉回归', async () => {
  await compare([start, middle, end]);
});

test('整块画面闪烁不能冒充菜单淡入，即使真实起点和终点仍匹配', async () => {
  const flash = PNG.sync.read(start);
  for (let offset = 0; offset < flash.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      flash.data[offset + channel] = Math.min(255, flash.data[offset + channel] + 20);
    }
  }
  await assert.rejects(compare([start, PNG.sync.write(flash), end]), /动画中途帧的实际画面须接近已审查轨迹/);
});

test('起点直接跳到终点不能冒充菜单淡入', async () => {
  await assert.rejects(compare([start, start, end]), /必须采到起点和终点之间的真实动画帧/);
});

const videoName = 'slot-popup-exit';
const videoStart = readFileSync(`${snapshots}${videoName}-start.png`);
const videoMiddle = readFileSync(`${snapshots}${videoName}-middle.png`);
const videoEnd = readFileSync(`${snapshots}${videoName}-end.png`);

/** Exercise the same video candidate and reviewed-phase assertions used by the recorder.
 * @param timeline - Simulated native video frames.
 */
function compareVideo(timeline) {
  const candidates = middleCandidates(videoStart, videoEnd, timeline, 'videoFrames');
  assertReviewedVideoMiddle(videoStart, videoEnd, candidates, [videoMiddle]);
}

test('真实录屏中途相位通过空间视觉回归', () => {
  compareVideo([videoStart, videoMiddle, videoEnd]);
});

test('录屏中的错误闪屏不能冒充弹窗滑出', () => {
  const flash = PNG.sync.read(videoStart);
  for (let offset = 0; offset < flash.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      flash.data[offset + channel] = Math.min(255, flash.data[offset + channel] + 10);
    }
  }
  assert.throws(() => compareVideo([videoStart, PNG.sync.write(flash), videoEnd]),
    /动画中途帧的实际画面须接近已审查轨迹/);
});

test('录屏中的反向位置不能冒充弹窗滑出', () => {
  const source = PNG.sync.read(videoMiddle);
  const reversed = PNG.sync.read(videoMiddle);
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const from = (y * source.width + source.width - 1 - x) * 4;
    const to = (y * source.width + x) * 4;
    source.data.copy(reversed.data, to, from, from + 4);
  }
  assert.throws(() => compareVideo([videoStart, PNG.sync.write(reversed), videoEnd]),
    /动画中途帧的实际画面须接近已审查轨迹/);
});

test('录屏直接跳到终点不能冒充弹窗滑出', () => {
  assert.throws(() => compareVideo([videoStart, videoStart, videoEnd]),
    /必须采到起点和终点之间的真实动画帧/);
});
