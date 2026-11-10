/** 用真实自动测试录像保护通用空间断言；这些输入不进入正式截图参考集合。 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decodeRecordedVideo } from './video-fixtures.mjs';

const require = createRequire(import.meta.url);
const { assertReviewedVideoMiddle, middleCandidates } = require('./animation-transition.ts');
const { maskScreenshot } = require('./screenshot.ts');
// 完整原片逐帧核对后的旧误收反例；输入字节及所有原空间门禁均保留。
// 判定理由见 quality/ci-42798414791-video-backdrop-counterexamples.md。
const backdropCounterexamples = new Map([[43, 'texas-holdem-card-rank-exit'],
  [47, 'texas-holdem-card-rank-exit'], [72, 'zhajinhua-leaderboard-exit']]);
const snapshots = new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url);
const directory = mkdtempSync(path.join(tmpdir(), 'clrn-recorded-transitions-'));
const collections = [['recorded-transitions', 79, 62], ['accurate-bet', 2, 1]].map(([name, count, kinds]) => {
  const fixture = new URL(`./fixtures/${name}/`, import.meta.url);
  return { fixture, count, kinds, directory: path.join(directory, name),
    manifest: JSON.parse(readFileSync(new URL('recordings.json', fixture), 'utf8')) };
});

/** 计算原始输入摘要，不重新编码原录像或原生首尾截图。
 * @param bytes - 原始附件字节。
 */
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

before(() => {
  for (const collection of collections) {
    const { fixture, manifest, count, kinds, directory } = collection;
    const archive = fileURLToPath(new URL('recordings.tar.gz', fixture));
    assert.equal(digest(readFileSync(archive)), manifest.archiveSha256, '录像归档必须保持已核对的原始字节');
    mkdirSync(directory);
    execFileSync('tar', ['-xzf', archive, '-C', directory]);
    assert.equal(manifest.records.length, count, '保留全部有完整首尾附件的录像');
    assert.equal(new Set(manifest.records.map(record => record.name)).size, kinds, '覆盖全部实际采到的转场种类');
  }
});

after(() => rmSync(directory, { recursive: true, force: true }));

/** 读取附件并逐项验证来源摘要。
 * @param asset - 清单中的原始附件。
 * @param directory - 该组录像的解包目录。
 */
function original(asset, directory) {
  const bytes = readFileSync(path.join(directory, asset.file));
  assert.equal(digest(bytes), asset.sha256, `原始附件不得改变：${asset.source}`);
  return bytes;
}

for (const { manifest, directory } of collections) for (const record of manifest.records) {
  test(`真实录屏 ${record.name}，${record.category} 第 ${record.retry + 1} 次运行、采集编号 ${record.id}`, () => {
    original(record.video, directory);
    const start = original(record.before, directory), end = original(record.after, directory);
    const framesDirectory = path.join(directory, `frames-${record.id}`);
    const { x, y } = record.region;
    // 与生产录屏使用同一解码参数，所有真实帧均参与选帧，不只重放报告中每五帧的抽样。
    const decoded = decodeRecordedVideo(path.join(directory, record.video.file), record.region, framesDirectory);
    assert.equal(decoded.length, record.timeline.length, '解码帧数必须与原报告完整时间线一致');
    const masks = record.masks.map(mask => ({ ...mask, x: mask.x - x, y: mask.y - y }));
    const frames = decoded.map(frame => maskScreenshot(frame, masks));
    // 接受距离只使用原调用方已有的已审查相位，首尾与本轮实际图都不能扩大参考集合。
    const anchors = record.anchors.map(file => readFileSync(new URL(file, snapshots)));
    /** 对完整原片执行同一生产空间及局部前景断言。 */
    const compare = () => assertReviewedVideoMiddle(start, end, middleCandidates(start, end, frames, 'videoFrames'), anchors);
    if (backdropCounterexamples.has(record.id)) {
      assert.equal(record.name, backdropCounterexamples.get(record.id), '负例身份必须与已核对的原录像一致');
      assert.throws(compare, /动画中途帧的实际画面须接近已审查轨迹/);
    } else compare();
    rmSync(framesDirectory, { recursive: true });
  });
}
