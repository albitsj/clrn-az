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
 * @param denseFrames - 区域采样独立保留的真实时间线输入。
 * @param commands - 记录实际选择的驱动命令。
 */
function deviceFor(frames, denseFrames = frames, commands = []) {
  return { _connection: { /** 提供模拟驱动。 */ toImpl: () => ({
    /** 按实际采集协议返回控件树、完整屏幕或时间线。
     * @param method - 原生驱动命令。
     * @param params - 实际请求的裁切区域。
     */
    _send: async (method, params) => {
      commands.push(method);
      if (method === 'tree') return { bounds: { x: 0, y: 0, width: 720, height: 1280 }, children: [] };
      if (method === 'screen') return frames[0].toString('base64');
      const source = method === 'assetFrames' ? denseFrames : frames;
      return [...source, ...Array(7).fill(source.at(-1))].map((png, index) => {
        const result = { capturedAt: index * 100, png: png.toString('base64') };
        if (method !== 'assetFrames') return result;
        const screen = PNG.sync.read(png);
        return { capturedAt: index * 100, regions: params.regions.map(region => {
          const part = new PNG({ width: region.width, height: region.height });
          PNG.bitblt(screen, part, region.x, region.y, region.width, region.height, 0, 0);
          return PNG.sync.write(part).toString('base64');
        }) };
      });
    },
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
 * @param name - 使用既有正式基准的道具名称。
 * @param sparse - 原生无损截图是否只保留飞行起点。
 */
function propScene(name = 'texas-prop-tea', sparse = false) {
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

test('登记的飞行位置锚点缺失必须失败，不能因主图匹配而静默跳过', async () => {
  const { name, frames, region, flightRegion } = propScene();
  const missing = `${name}-flight-peak-alternate.png`;
  const info = { config: { updateSnapshots: 'none' }, /** 本例不保存附件。 */ attach: async () => {},
    /** 仅模拟一个已登记的真实锚点文件丢失。
     * @param file - 基准名。
     */
    snapshotPath: file => fileURLToPath(new URL(file === missing ? `missing/${file}` : file, snapshots)) };
  await assert.rejects(captureAssetSequence(deviceFor(frames), name, info, region, async () => {},
    flightRegion),
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

test('稀疏整屏截图漏掉飞行时，密集原生区域仍按原锚点验证同一次真实触发', async () => {
  const scene = propScene('texas-prop-tea', true);
  const attachments = new Map();
  let triggers = 0;
  /** 对同一次消息采集飞行画面，两种采样不能分别重发消息。 */
  const trigger = async () => { triggers++; };
  await captureAssetSequence(deviceFor(scene.frames, propScene().frames), scene.name, sequenceInfo(attachments),
    scene.region, trigger, scene.flightRegion);
  assert.equal(triggers, 1);
  assert.deepEqual(attachments.get(`${scene.name}-flight-peak.png`), scene.flight[1]);
});

for (const name of ['texas-prop-water', 'texas-prop-beer', 'zhajinhua-prop-tea']) {
  test(`${name} 保留原无损整屏采样，不进入区域采样`, async () => {
    const scene = propScene(name);
    const commands = [];
    await captureAssetSequence(deviceFor(scene.frames, scene.frames, commands), name, sequenceInfo(new Map()), scene.region,
      async () => {}, scene.flightRegion);
    assert.equal(commands.includes('assetFrames'), false);
    assert.equal(commands.includes('motionFrames'), true);
  });
}

for (const name of ['texas-prop-tea', 'texas-prop-water']) {
  test(`${name} 没有真实飞行时仍失败，不用接收者播放代替路径`, async () => {
    const scene = propScene(name, true);
    await assert.rejects(captureAssetSequence(deviceFor(scene.frames), name, sequenceInfo(new Map()),
      scene.region, async () => {}, scene.flightRegion), /道具必须飞过目标路线/);
  });
}

test('真实区域帧和采集时间在比较前写入报告', async () => {
  const scene = propScene();
  const attachments = new Map();
  const commands = [];
  await captureAssetSequence(deviceFor(scene.frames, scene.frames, commands), scene.name, sequenceInfo(attachments),
    scene.region, async () => {}, scene.flightRegion);
  assert.equal(commands.includes('assetFrames'), true);
  assert.equal(commands.includes('motionFrames'), false);
  const metadata = JSON.parse(attachments.get(`${scene.name}-native-sampling`));
  assert.equal(metadata.method, 'assetFrames');
  assert.deepEqual(metadata.regions, [scene.region, scene.flightRegion]);
  assert.deepEqual(metadata.capturedAt, Array.from({ length: 10 }, (_, index) => index * 100));
  assert.deepEqual(attachments.get(`${scene.name}-native-flight-0001.png`), scene.flight[1]);
});
