import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { exists } = require('./native-state.ts');

for (const bounds of [
  { x: 720, y: 10, width: 10, height: 10 }, { x: 10, y: 1280, width: 10, height: 10 },
  { x: -10, y: 10, width: 10, height: 10 }, { x: 10, y: -10, width: 10, height: 10 },
  { x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: 10, height: 0 },
]) {
  test(`屏幕外或无尺寸的历史弹层不算存在：${JSON.stringify(bounds)}`, async () => {
    assert.equal(await exists({ info: /** 返回场景的实际查询边界。 */ async () => ({ bounds }) }, { res: 'overlay' }), false);
  });
}

test('部分越出屏幕但仍有可见像素的控件继续算存在', async () => {
  assert.equal(await exists({ info: /** 保留部分可见的控件。 */ async () => ({ bounds: { x: -1, y: -1, width: 2, height: 2 } }) }, { res: 'overlay' }), true);
});

test('过期对象重查四次后保留原始错误，不把驱动异常当作消失', async () => {
  const failure = new Error('androidx.test.uiautomator.StaleObjectException');
  let attempts = 0;
  await assert.rejects(exists({ info: /** 持续报告同一个过期对象错误。 */ async () => { attempts++; throw failure; } }, { res: 'overlay' }), error => error === failure);
  assert.equal(attempts, 5);
});
