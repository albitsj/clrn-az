import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { captureNativeTransition } = require('./animation-transition.ts');
const { gamePanelSamplingMethod } = require('./game-panel-animation.ts');
const root = new URL('./fixtures/chat-actions-return/', import.meta.url);

/** 重放同一次采样的原始裁切像素和时间，不改变比较器或正式基准。
 * @param frames - 真实二十帧。
 * @param timestamps - 同次采样的设备时间。
 */
async function replay(frames, timestamps) {
  let screenshot = 0;
  const name = 'texas-holdem-chat-actions-return-enter';
  const device = { _connection: { /** 只模拟原设备传输边界。 */ toImpl: () => ({
    /** 返回真实原始帧，不构造中间相位。
     * @param method - 原采样命令。
     */ _send: async method => method === 'screen'
      ? frames[screenshot++ === 0 ? 0 : 19].toString('base64')
      : frames.map((frame, i) => ({ png: frame.toString('base64'), capturedAt: timestamps[i] })),
  }) } };
  const info = { config: { updateSnapshots: 'none' }, /** 本地回放无需附件。 */ attach: async () => {},
    /** 仍读取正式已审查基准。
     * @param file - 正式基准名。
     */ snapshotPath: file => new URL(`./snapshots/android-35-x86_64-720x1280-en/${file}`, import.meta.url).pathname };
  const { width, height } = PNG.sync.read(frames[0]);
  await captureNativeTransition(device, name, info, { x: 0, y: 0, width, height }, () => {}, [], [], 0, 'motionFrames');
}

test('复用 bc3048e 的聊天菜单重入采样修复，保持其他路径选择', () => {
  assert.equal(gamePanelSamplingMethod('texas-holdem', 'chat-actions-return', 'enter', 'motionFrames'), 'videoFrames');
  assert.equal(gamePanelSamplingMethod('texas-holdem', 'chat-actions-return', 'exit', 'motionFrames'), 'motionFrames');
  assert.equal(gamePanelSamplingMethod('zhajinhua', 'chat-actions-return', 'enter', 'motionFrames'), 'motionFrames');
});

test('历史 run 42560149951 只有首尾的漏帧仍被拒绝', async () => {
  const record = JSON.parse(readFileSync(new URL('timeline.json', root)));
  const images = {};
  for (const [file, digest] of Object.entries(record.images)) {
    images[file] = readFileSync(new URL(file, root));
    assert.equal(createHash('sha256').update(images[file]).digest('hex'), digest);
  }
  await assert.rejects(replay(record.frames.map(([, file]) => images[file]), record.frames.map(([time]) => time)),
    /必须采到起点和终点之间的真实动画帧/);
});

const current = JSON.parse(readFileSync(new URL('run-43216255394.json', root)));
for (const record of current.records) test(`本轮原始二十帧重放 retry${record.retry}: ${record.status}`, async () => {
  const frames = record.frames.map(file => {
    const image = readFileSync(new URL(file, root));
    assert.equal(createHash('sha256').update(image).digest('hex') + '.png', file);
    return image;
  });
  assert.equal(frames.length, 20);
  if (record.status === 'failed') await assert.rejects(replay(frames, record.timestamps), /动画中途帧的实际画面须接近已审查轨迹/);
  else await replay(frames, record.timestamps);
});
