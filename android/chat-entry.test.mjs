/** 固定原始聊天录像，保证未知失败继续阻塞，不把第三轮通过当作首轮修复。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
import { decodeRecordedVideo } from './video-fixtures.mjs';

const require = createRequire(import.meta.url);
const { captureNativeTransition } = require('./animation-transition.ts');
const fixture = new URL('./fixtures/chat-entry/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('recordings.json', fixture), 'utf8'));
const directory = mkdtempSync(path.join(tmpdir(), 'clrn-chat-entry-'));
const snapshots = new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url);

/** 验证原始归档及附件字节。
 * @param bytes - 未改写的原始文件。
 */
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

before(() => {
  const archive = fileURLToPath(new URL('recordings.tar.gz', fixture));
  assert.equal(digest(readFileSync(archive)), manifest.archiveSha256);
  execFileSync('tar', ['-xzf', archive, '-C', directory]);
  const build = JSON.parse(readFileSync(path.join(directory, 'build-info.json'), 'utf8'));
  assert.equal(build.applicationCommit, manifest.applicationCommit);
  assert.equal(build.package.sha256, manifest.apkSha256);
  assert.deepEqual(manifest.records.map(record => record.status), ['failed', 'failed', 'passed']);
});

after(() => rmSync(directory, { recursive: true, force: true }));

/** 读取并核对原始报告附件。
 * @param asset - 原始文件路径与摘要。
 */
function original(asset) {
  const bytes = readFileSync(path.join(directory, asset.file));
  assert.equal(digest(bytes), asset.sha256, asset.source);
  return bytes;
}

for (const record of manifest.records) test(`聊天入场 retry${record.retry} 完整采集重放：${record.status}`, async () => {
  original(record.video);
  const start = original(record.before), end = original(record.after);
  const framesDirectory = path.join(directory, `frames-${record.retry}`);
  const { x, y, width, height } = record.region;
  // 与设备生产入口相同参数，保留所有帧，不把新增或实际图片加入接受参考。
  const frames = decodeRecordedVideo(path.join(directory, record.video.file), record.region, framesDirectory);
  assert.equal(frames.length, record.timeline.length, '完整解码帧数须与失败报告时间线一致');
  let triggered = false;
  const attachments = new Map();
  const device = { _connection: { /** 仅替换外部设备输入。 */ toImpl: () => ({
    /** 在实际区域还原原始首尾截图，生产函数继续裁切并执行所有断言。
     * @param method - 原生驱动命令。
     */
    _send: async method => {
      assert.equal(method, 'screen');
      const part = PNG.sync.read(triggered ? end : start);
      const canvas = new PNG({ width: 720, height: 1280 });
      PNG.bitblt(part, canvas, 0, 0, width, height, x, y);
      return PNG.sync.write(canvas).toString('base64');
    },
  }) } };
  const info = { config: { updateSnapshots: 'none' },
    /** 使用正式已有参考。
     * @param name - 原调用方的图片名称。
     */
    snapshotPath: name => new URL(name, snapshots).pathname,
    /** 保留生产采集产生的实际像素和时间线。
     * @param name - 附件名。
     * @param attachment - 实际采集数据。
     */
    attach: async (name, attachment) => attachments.set(name, attachment.body),
  };
  const name = 'texas-holdem-chat-enter';
  /** 原入口与原断言均执行，只将真实录像送入外部录屏边界。 */
  const capture = () => captureNativeTransition(device, name, info, record.region, () => { triggered = true; },
    [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [],
    /** 返回原始视频解码的全部帧。
     * @param _name - 转场名称。
     * @param _region - 原有区域。
     * @param trigger - 原入口触发回调。
     */
    async (_name, _region, trigger) => { await trigger(); return frames; });
  if (record.expectedError) await assert.rejects(capture(), new RegExp(record.expectedError));
  else await capture();
  assert.deepEqual(JSON.parse(attachments.get(`${name}-timeline`)), record.timeline);
  assert.equal(attachments.get(`${name}-progress`) !== undefined, true);
  assert.deepEqual(attachments.get(`${name}-start`), start);
  assert.deepEqual(attachments.get(`${name}-end`), end);
});
