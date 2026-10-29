/** 用真实自动测试录像保护通用空间断言；这些输入不进入正式截图参考集合。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { assertReviewedVideoMiddle, middleCandidates } = require('./animation-transition.ts');
const { maskScreenshot } = require('./screenshot.ts');
const fixture = new URL('./fixtures/recorded-transitions/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('recordings.json', fixture), 'utf8'));
const snapshots = new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url);
const ffmpeg = process.platform === 'linux'
  ? fileURLToPath(new URL('../node_modules/@ffmpeg-installer/linux-x64/ffmpeg', import.meta.url)) : 'ffmpeg';
const directory = mkdtempSync(path.join(tmpdir(), 'clrn-recorded-transitions-'));

/** 计算原始输入摘要，不重新编码原录像或原生首尾截图。
 * @param bytes - 原始附件字节。
 */
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

before(() => {
  const archive = fileURLToPath(new URL('recordings.tar.gz', fixture));
  assert.equal(digest(readFileSync(archive)), manifest.archiveSha256, '录像归档必须保持已核对的原始字节');
  execFileSync('tar', ['-xzf', archive, '-C', directory]);
  assert.equal(manifest.records.length, 79, '保留本轮全部有完整首尾附件的录像');
  assert.equal(new Set(manifest.records.map(record => record.name)).size, 62, '覆盖全部实际采到的转场种类');
});

after(() => rmSync(directory, { recursive: true, force: true }));

/** 读取附件并逐项验证来源摘要。
 * @param asset - 清单中的原始附件。
 */
function original(asset) {
  const bytes = readFileSync(path.join(directory, asset.file));
  assert.equal(digest(bytes), asset.sha256, `原始附件不得改变：${asset.source}`);
  return bytes;
}

for (const record of manifest.records) {
  test(`真实录屏 ${record.name}，${record.category} 第 ${record.retry + 1} 次运行、采集编号 ${record.id}`, () => {
    original(record.video);
    const start = original(record.before), end = original(record.after);
    const framesDirectory = path.join(directory, `frames-${record.id}`);
    mkdirSync(framesDirectory);
    const { x, y, width, height } = record.region;
    // 与生产录屏使用同一解码参数，所有真实帧均参与选帧，不只重放报告中每五帧的抽样。
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', path.join(directory, record.video.file), '-vf',
      `fps=30,scale=720:1280:flags=lanczos,crop=${width}:${height}:${x}:${y}`,
      path.join(framesDirectory, 'frame-%04d.png')]);
    const files = readdirSync(framesDirectory).sort();
    assert.equal(files.length, record.timeline.length, '解码帧数必须与原报告完整时间线一致');
    const masks = record.masks.map(mask => ({ ...mask, x: mask.x - x, y: mask.y - y }));
    const frames = files.map(file => maskScreenshot(readFileSync(path.join(framesDirectory, file)), masks));
    // 接受距离只使用原调用方已有的已审查相位，首尾与本轮实际图都不能扩大参考集合。
    const anchors = record.anchors.map(file => readFileSync(new URL(file, snapshots)));
    assertReviewedVideoMiddle(start, end, middleCandidates(start, end, frames, 'videoFrames'), anchors);
    rmSync(framesDirectory, { recursive: true });
  });
}
