import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { preserveAssetSamples } = require('./asset-sample-diagnostics.ts');
const { motionParts } = require('./motion-regions.ts');
const png = readFileSync(new URL('./snapshots/android-35-x86_64-720x1280-en/texas-prop-tea-start.png', import.meta.url));
const region = { x: 0, y: 0, width: 10, height: 10 };

for (const name of ['texas-prop-tea', 'zhajinhua-prop-water', 'zhajinhua-prop-beer']) {
  test(`${name} 诊断保留所有尝试的真实时间戳及原区域像素，不输出完整屏幕`, async () => {
    const samples = [0, 1].map(attempt => ({ attempt, frames: [10, 57, 131].map(capturedAt =>
      ({ capturedAt, png: png.toString('base64') })) }));
    const attachments = [];
    await preserveAssetSamples(name, { /** 保存原始附件。
     * @param args - 附件名及内容。
     */ attach: async (...args) => attachments.push(args) },
      samples, region, { ...region, x: 10 });
    assert.equal(attachments.length, 1);
    const [attachmentName, attachment] = attachments[0];
    assert.equal(attachmentName, `${name}-raw-samples`);
    const result = JSON.parse(attachment.body);
    assert.deepEqual(result.attempts.map(sample => sample.attempt), [0, 1]);
    const expected = motionParts(png, [region, { ...region, x: 10 }]).regions.map(frame => frame.toString('base64'));
    for (const sample of result.attempts) {
      assert.deepEqual(sample.frames.map(frame => frame.capturedAt), [10, 57, 131]);
      assert.deepEqual(sample.frames.map(frame => frame.regions), Array(3).fill(expected));
    }
  });

  test(`${name} 裁切或附件写入失败不抛出异常，其他道具不增加诊断`, async () => {
    const samples = [{ attempt: 0, frames: [{ capturedAt: 19, png: png.toString('base64') }] }];
    let calls = 0;
    const info = { /** 模拟附件不可写。 */ attach: async () => { calls++; throw new Error('attachment unavailable'); } };
    await preserveAssetSamples(name, info, samples, region);
    assert.equal(calls, 1);
    await preserveAssetSamples(name, info,
      [{ attempt: 0, frames: [{ capturedAt: 19, png: 'invalid' }] }], region);
    await preserveAssetSamples('texas-prop-beer', info, samples, region);
    assert.equal(calls, 1);
  });
}
