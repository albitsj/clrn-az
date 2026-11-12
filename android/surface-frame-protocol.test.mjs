import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { SurfaceFrameParser, surfaceSize } = require('./surface-frame-protocol.ts');

/** 构造 AOSP Android 35 的真实包结构。
 * @param value - 当前帧的 RGB 填充值。
 */
export function surfacePacket(value = 17) {
  const { width, height } = surfaceSize;
  const pixels = Buffer.alloc(width * height * 3, value);
  const header = Buffer.alloc(20);
  [pixels.length + 16, width, height, width * 3, 3].forEach((field, index) => header.writeUInt32LE(field, index * 4));
  return Buffer.concat([header, pixels]);
}

test('Android 原始协议跨任意包头和像素分块，保持真实 RGB 顺序', () => {
  const parser = new SurfaceFrameParser();
  const bytes = Buffer.concat([surfacePacket(11), surfacePacket(29)]);
  const frames = [];
  for (let offset = 0; offset < bytes.length; offset += 1093) frames.push(...parser.push(bytes.subarray(offset, offset + 1093)));
  assert.equal(frames.length, 2);
  assert.ok(frames[0].equals(Buffer.alloc(240 * 426 * 3, 11)));
  assert.ok(frames[1].equals(Buffer.alloc(240 * 426 * 3, 29)));
  assert.equal(parser.tailBytes(), 0);
});

for (const offset of [0, 4, 8, 12, 16]) {
  test(`帧头字段 ${offset} 漂移必须失败，不能按新尺寸分配内存`, () => {
    const header = surfacePacket().subarray(0, 20);
    header.writeUInt32LE(0xffffffff, offset);
    assert.throws(() => new SurfaceFrameParser().push(header), /帧头无效/);
  });
}

test('记录末尾未完整包的字节数，不能把半帧当成真实画面', () => {
  const parser = new SurfaceFrameParser();
  assert.deepEqual(parser.push(surfacePacket().subarray(0, 131)), []);
  assert.equal(parser.tailBytes(), 131);
});

test('原始帧严格限制 240 帧预算', () => {
  const parser = new SurfaceFrameParser();
  const packet = surfacePacket();
  for (let i = 0; i < 240; i++) assert.equal(parser.push(packet).length, 1);
  assert.throws(() => parser.push(packet), /240 帧预算/);
});
