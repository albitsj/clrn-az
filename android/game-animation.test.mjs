import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { loadGameFlow } from './game-flow-fixture.mjs';

const require = createRequire(import.meta.url);
const { motionParts, samePixels } = require('./motion-regions.ts');
const name = 'en-signed-in-zhajinhua-game-challenge-select';
const snapshots = new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url);
const expected = readFileSync(new URL(`${name}.png`, snapshots));
const fixture = new URL('./fixtures/challenge-selection/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('source.json', fixture)));
const firstAttempt = readFileSync(new URL(source.file, fixture));
const selectors = [
  { x: 184, y: 169, width: 100, height: 100 }, { x: 30, y: 320, width: 100, height: 100 },
  { x: 30, y: 508, width: 100, height: 100 }, { x: 30, y: 696, width: 100, height: 100 },
].map(bounds => ({ res: 'challenge_player_selector', bounds }));

/** 单元测试只缩短外层轮询，像素比较及全部业务断言仍执行生产代码。
 * @param value - 真实断言值或采样回调。
 * @param message - 生产断言文字。
 */
function boundedExpect(value, message) {
  if (typeof value !== 'function') return expect(value, message);
  return { /** 测试输入已提供完整窗口，不靠墙钟等待或重试用例。 */ toPass: async () => value() };
}

/** 用原始失败帧和现有审查基准驱动完整生产采集流程。
 * @param pictures - 原生连续截图输入。
 * @param timestamps - 设备采集时刻。
 */
async function capture(pictures, timestamps = [100, 1100, 2100, 3100, 4100, 5100]) {
  const attachments = new Map();
  const device = { _connection: { /** 返回限定的原生连续采样协议。 */ toImpl: () => ({
    /** 只能使用连续采集，不能重新退回逐次 screencap。
     * @param method - 生产采样命令。
     */
    _send: async method => {
      assert.equal(method, 'challengeFrames');
      return pictures.map((png, index) => ({ capturedAt: timestamps[index], png: png.toString('base64') }));
    },
  }) } };
  const { captureChallengeAnimation } = loadGameFlow('./game-animation.ts', {
    '@playwright/test': { expect: boundedExpect },
    'node:fs': { readFileSync },
    './game-controls': { /** 返回报告中的真实四个选择框边界。 */ gameNodes: async () => selectors },
    './motion-regions': require('./motion-regions.ts'),
    './screenshot': require('./screenshot.ts'),
    './game-animation-sampling': require('./game-animation-sampling.ts'),
  });
  const info = {
    config: { updateSnapshots: 'none' },
    /** 保留最终图片、相位证据和失败附件。
     * @param label - 生产附件名。
     * @param data - 原始附件内容。
     */ attach: async (label, data) => { attachments.set(label, data); },
    /** 只读取已审查基准，不生成替代图。
     * @param file - 生产快照名。
     */ snapshotPath: file => new URL(file, snapshots),
  };
  await captureChallengeAnimation(device, name, info, []);
  return attachments;
}

/** 只改变指定区域，用于验证真实视觉回归仍会失败。
 * @param bytes - 原始完整 PNG。
 * @param area - 要损坏的可见区域。
 */
function damaged(bytes, area) {
  const picture = PNG.sync.read(bytes);
  for (let row = area.y; row < area.y + area.height; row++) {
    picture.data.fill(255, (row * picture.width + area.x) * 4, (row * picture.width + area.x + area.width) * 4);
  }
  return PNG.sync.write(picture);
}

test('连续采样覆盖历史漏采的真实闪烁相位，保留四个玩家的完整原始匹配帧', async () => {
  assert.equal(createHash('sha256').update(firstAttempt).digest('hex'), source.sha256);
  const report = await capture([firstAttempt, expected, firstAttempt, expected, firstAttempt, expected]);
  const regions = JSON.parse(report.get(`${name}-animation-regions`).body);
  const reference = motionParts(expected, regions).regions;
  for (const player of [1, 2, 3, 4]) {
    const original = report.get(`${name}-matched-player-${player}`).body;
    assert.ok([firstAttempt, expected].some(frame => frame.equals(original)));
    assert.ok(samePixels(motionParts(original, regions).regions[player - 1], reference[player - 1]));
  }
});

test('静止的正确基准也不能冒充真实闪烁动画', async () => {
  await assert.rejects(capture(Array(6).fill(expected)), /四个选择框应实际闪烁/);
});

test('持续漏掉第一个玩家匹配相位仍然失败，禁止放宽基准', async () => {
  await assert.rejects(capture(Array(6).fill(firstAttempt)), /四位玩家及高亮框/);
});

test('玩家区域出现真实视觉回归时，即使其他区域匹配也必须失败', async () => {
  const pictures = [firstAttempt, expected, firstAttempt, expected, firstAttempt, expected]
    .map(bytes => damaged(bytes, { x: 184, y: 169, width: 100, height: 100 }));
  await assert.rejects(capture(pictures), /四位玩家及高亮框/);
});

test('背景变化不能被动画分区匹配掩盖', async () => {
  const pictures = [firstAttempt, expected, firstAttempt, expected, firstAttempt, expected]
    .map(bytes => damaged(bytes, { x: 350, y: 300, width: 200, height: 200 }));
  await assert.rejects(capture(pictures), /动画之外的全部像素/);
});

test('编码和比较耗时不能代替四秒真实设备观察窗口', async () => {
  await assert.rejects(capture([firstAttempt, expected, firstAttempt, expected, firstAttempt, expected],
    [100, 101, 102, 103, 104, 105]), /4000/);
});

test('乱序或重复的设备帧时间戳必须失败', async () => {
  await assert.rejects(capture([firstAttempt, expected, firstAttempt, expected, firstAttempt, expected],
    [100, 1100, 1100, 3100, 4100, 5100]), /原生帧时间必须严格递增/);
});
