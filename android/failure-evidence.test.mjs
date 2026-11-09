import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { preserveAssetSamples } = require('./asset-sample-diagnostics.ts');
const { preserveCaptureAlert } = require('./capture-alert-diagnostics.ts');

test('失败证据保留原生时间戳和全部区域帧，排除区域外像素', async () => {
  const image = new PNG({ width: 4, height: 4 });
  image.data.fill(255);
  const png = PNG.sync.write(image).toString('base64');
  let result;
  const info = { /** 保存报告附件供断言。
   * @param _name - 附件名。
   * @param attachment - 附件数据。
   */ attach: async (_name, attachment) => { result = JSON.parse(attachment.body); } };
  await preserveAssetSamples('texas-prop-beer', info,
    [{ attempt: 0, frames: [100, 180, 290].map(capturedAt => ({ capturedAt, png })) }],
    [{ x: 1, y: 1, width: 2, height: 2 }]);
  assert.deepEqual(result.attempts[0].frames.map(frame => frame.capturedAt), [100, 180, 290]);
  const cropped = PNG.sync.read(Buffer.from(result.attempts[0].frames[0].regions[0], 'base64'));
  assert.equal(cropped.width, 2);
  assert.equal(cropped.height, 2);
});

test('提示诊断不输出未知消息或身份，附件失败不向调用方抛出', async () => {
  let body;
  const info = { /** 保存报告附件供断言。
   * @param _name - 附件名。
   * @param attachment - 附件数据。
   */ attach: async (_name, attachment) => { body = attachment.body; } };
  await preserveCaptureAlert(info, 'hand_end', [
    { res: 'common-alert-message', text: 'secret-user-token', bounds: {} },
    { res: 'player-name', text: 'private-name', bounds: {} },
  ]);
  assert.equal(body.includes('secret-user-token'), false);
  assert.equal(body.includes('private-name'), false);
  const unavailable = { /** 模拟报告写入失败。 */ attach: async () => { throw new Error('attachment unavailable'); } };
  await preserveCaptureAlert(unavailable, 'hand_end', []);
  await preserveAssetSamples('texas-prop-beer', unavailable, [], []);
});
