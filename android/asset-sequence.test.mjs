import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { captureAssetSequence } = require('./asset-sequence.ts');
const snapshots = new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url);

/** 用已审查的真实素材帧模拟同一条原生采集时间线。
 * @param frames - 完整屏幕帧，首帧同时作为效果播放前后的屏幕。
 */
function deviceFor(frames) {
  return { _connection: { /** 提供模拟驱动。 */ toImpl: () => ({
    /** 按实际采集协议返回控件树、完整屏幕或时间线。
     * @param method - 原生驱动命令。
     */
    _send: async method => method === 'tree' ? { bounds: { x: 0, y: 0, width: 720, height: 1280 }, children: [] }
      : method === 'screen' ? frames[0].toString('base64')
        : [...frames, ...Array(7).fill(frames.at(-1))]
          .map((png, index) => ({ capturedAt: index * 100, png: png.toString('base64') })),
  }) } };
}

test('目录中额外存在备用图不能放行素材主基准的明显差异', async () => {
  const name = 'zhajinhua-prop-tea';
  const frames = ['start', 'peak', 'changed'].map(phase => readFileSync(new URL(`${name}-${phase}.png`, snapshots)));
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-asset-policy-'));
  try {
    for (const [index, phase] of ['start', 'peak', 'changed'].entries()) {
      writeFileSync(path.join(directory, `${name}-${phase}.png`), frames[index]);
    }
    writeFileSync(path.join(directory, `${name}-peak-alternate.png`), frames[1]);
    const wrong = PNG.sync.read(frames[1]);
    wrong.data.fill(0);
    for (let offset = 3; offset < wrong.data.length; offset += 4) wrong.data[offset] = 255;
    writeFileSync(path.join(directory, `${name}-peak.png`), PNG.sync.write(wrong));
    const info = { config: { updateSnapshots: 'none' }, /** 本例不保存附件。 */ attach: async () => {},
      /** 使用真实文件系统中的主图及未登记备用图。
       * @param file - 基准名。
       */
      snapshotPath: file => path.join(directory, file) };
    const { width, height } = PNG.sync.read(frames[0]);
    await assert.rejects(captureAssetSequence(deviceFor(frames), name, info,
      { x: 0, y: 0, width, height }, async () => {}), /peak 视觉回归/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

/** 用已审查区域组成单元输入，刻意令稀疏截图漏掉飞行位置时仍保留接收者的真实素材帧。
 * @param sparse - 原生无损截图是否只保留飞行起点。
 */
function teaScene(sparse = false) {
  const name = 'texas-prop-tea';
  const body = ['start', 'peak', 'changed'].map(phase => PNG.sync.read(readFileSync(new URL(`${name}-${phase}.png`, snapshots))));
  const flight = ['start', 'peak', 'changed'].map(phase => PNG.sync.read(readFileSync(new URL(`${name}-flight-${phase}.png`, snapshots))));
  const frames = body.map((picture, index) => {
    const canvas = new PNG({ width: picture.width + flight[index].width, height: Math.max(picture.height, flight[index].height) });
    PNG.bitblt(picture, canvas, 0, 0, picture.width, picture.height, 0, 0);
    PNG.bitblt(flight[sparse ? 0 : index], canvas, 0, 0, flight[index].width, flight[index].height, picture.width, 0);
    return PNG.sync.write(canvas);
  });
  return { name, body, flight: flight.map(picture => PNG.sync.write(picture)), frames,
    region: { x: 0, y: 0, width: body[0].width, height: body[0].height },
    flightRegion: { x: body[0].width, y: 0, width: flight[0].width, height: flight[0].height } };
}

/** 仅替换外部录屏，真实触发、截图、裁切及严格锚点比较继续执行。
 * @param frames - 此次连续飞行采集的裁切帧。
 */
function flightRecorder(frames) {
  return async (_name, _region, trigger) => { await trigger(); return frames; };
}

test('登记的飞行位置锚点缺失必须失败，不能因主图匹配而静默跳过', async () => {
  const { name, frames, flight, region, flightRegion } = teaScene();
  const missing = `${name}-flight-peak-alternate.png`;
  const info = { config: { updateSnapshots: 'none' }, /** 本例不保存附件。 */ attach: async () => {},
    /** 仅模拟一个已登记的真实锚点文件丢失。
     * @param file - 基准名。
     */
    snapshotPath: file => fileURLToPath(new URL(file === missing ? `missing/${file}` : file, snapshots)) };
  await assert.rejects(captureAssetSequence(deviceFor(frames), name, info, region, async () => {},
    flightRegion, flightRecorder(flight)),
  error => error.code === 'ENOENT' && error.path.endsWith(missing));
});

/** 继续使用唯一正式锚点，附件只保存在当前用例内。
 * @param attachments - 当前报告附件。
 */
function sequenceInfo(attachments) {
  return { config: { updateSnapshots: 'none' }, /** 保留原始比较输入。
    * @param name - 附件名。
    * @param value - 原始附件。
    */ attach: async (name, value) => attachments.set(name, value.body),
  /** 只读取原有正式基准。
   * @param file - 已登记文件名。
   */ snapshotPath: file => fileURLToPath(new URL(file, snapshots)) };
}

test('无损截图漏掉飞行位置时，独立连续录屏仍按原锚点验证同一次真实触发', async () => {
  const scene = teaScene(true);
  const attachments = new Map();
  let triggers = 0;
  /** 对同一次消息采集飞行画面，截图与录屏触发不能分别重发消息。 */
  const trigger = async () => { triggers++; };
  await captureAssetSequence(deviceFor(scene.frames), scene.name, sequenceInfo(attachments),
    scene.region, trigger, scene.flightRegion, flightRecorder(scene.flight));
  assert.equal(triggers, 1);
  assert.deepEqual(attachments.get(`${scene.name}-flight-peak.png`), scene.flight[1]);
});

test('连续录屏没有真实飞行时仍失败，不用接收者播放或起止截图代替路径', async () => {
  const scene = teaScene();
  await assert.rejects(captureAssetSequence(deviceFor(scene.frames), scene.name, sequenceInfo(new Map()),
    scene.region, async () => {}, scene.flightRegion, flightRecorder(Array(20).fill(scene.flight[0]))),
  /道具必须飞过目标路线/);
});
