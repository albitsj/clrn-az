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

test('登记的飞行位置锚点缺失必须失败，不能因主图匹配而静默跳过', async () => {
  const name = 'texas-prop-tea';
  const body = ['start', 'peak', 'changed'].map(phase => PNG.sync.read(readFileSync(new URL(`${name}-${phase}.png`, snapshots))));
  const flight = ['start', 'peak', 'changed'].map(phase => PNG.sync.read(readFileSync(new URL(`${name}-flight-${phase}.png`, snapshots))));
  const frames = body.map((picture, index) => {
    const canvas = new PNG({ width: picture.width + flight[index].width, height: Math.max(picture.height, flight[index].height) });
    PNG.bitblt(picture, canvas, 0, 0, picture.width, picture.height, 0, 0);
    PNG.bitblt(flight[index], canvas, 0, 0, flight[index].width, flight[index].height, picture.width, 0);
    return PNG.sync.write(canvas);
  });
  const missing = `${name}-flight-peak-alternate.png`;
  const info = { config: { updateSnapshots: 'none' }, /** 本例不保存附件。 */ attach: async () => {},
    /** 仅模拟一个已登记的真实锚点文件丢失。
     * @param file - 基准名。
     */
    snapshotPath: file => fileURLToPath(new URL(file === missing ? `missing/${file}` : file, snapshots)) };
  await assert.rejects(captureAssetSequence(deviceFor(frames), name, info,
    { x: 0, y: 0, width: body[0].width, height: body[0].height }, async () => {},
    { x: body[0].width, y: 0, width: flight[0].width, height: flight[0].height }),
  error => error.code === 'ENOENT' && error.path.endsWith(missing));
});
