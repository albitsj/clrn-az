/** 重放同轮空态淡入首败和成功重试；长原生命令仍须严格检查采样终点。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { captureNativeTransition } = require('./animation-transition.ts');
const root = new URL('./fixtures/club-rooms-empty/', import.meta.url);
const history = JSON.parse(readFileSync(new URL('timelines.json', root), 'utf8'));
const name = 'club-rooms-empty-enter';
const snapshots = fileURLToPath(new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url));

for (const record of history.records) {
  test(`俱乐部空态 retry${record.retry} 原始采样端点回放`, async () => {
    let screens = 0;
    const device = { _connection: { /** 返回模拟原生连接。 */ toImpl: () => ({
      /** 仅替换原生边界，完整保留原始帧及其时间戳。
       * @param method - 实际驱动命令。
       */
      _send: async method => {
        if (method === 'screen') return readFileSync(new URL(screens++ === 0 ? 'start.png' : 'end.png', root)).toString('base64');
        assert.equal(method, 'launchFrames');
        return record.frames.map((file, index) => ({ capturedAt: record.timestamps[index],
          png: readFileSync(new URL(file, root)).toString('base64') }));
      },
    }) } };
    const info = { /** 原始回放无需写入报告。 */ attach: async () => {}, config: { updateSnapshots: 'none' },
      /** 继续读取唯一正式基准。
       * @param file - 原始基准名。
       */
      snapshotPath: file => `${snapshots}${file}` };
    const pending = captureNativeTransition(device, name, info,
      { x: 0, y: 0, width: 520, height: 200 }, () => {}, [], [], 0, 'launchFrames');
    if (record.status === 'failed') await assert.rejects(pending, /采样结束时动画必须完成/);
    else await pending;
  });
}
