import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { expectScreenshot, networkCodeReference } = require('./snapshot-assertion.ts');
const { maskScreenshot } = require('./screenshot.ts');
const comparator = require('playwright-core/lib/coreBundle').utils.getComparator('image/png');
const { screenshotComparison } = require('./screenshot-comparison.ts');
const oldMask = { x: 80, y: 90, width: 10, height: 5, reason: 'game-network-proxy-code' };
const currentMask = { ...oldMask, x: 75, width: 15 };

/**
 * 一万个有效像素中保留独立业务变化，模拟节点编号从单个变为两个时的遮罩差异。
 * @param count - 节点编号之外的业务差异像素数。
 */
function picture(count = 0) {
  const png = new PNG({ width: 100, height: 100 });
  png.data.fill(255);
  for (let index = 0; index < count; index++) {
    png.data.fill(0, index * 4, index * 4 + 3);
  }
  return PNG.sync.write(png);
}

test('两个节点只统一已有编号遮罩，业务差异仍按五十个通过、五十一个失败', () => {
  const expected = maskScreenshot(picture(), [oldMask]);
  const original = Buffer.from(expected);
  const normalized = networkCodeReference(expected, [currentMask]);
  for (const [count, passes] of [[50, true], [51, false]]) {
    const actual = maskScreenshot(picture(count), [currentMask]);
    assert.notEqual(comparator(actual, expected, screenshotComparison), null, '旧的单边遮罩必须重现误报');
    assert.equal(comparator(actual, normalized, screenshotComparison) === null, passes,
      '节点编号不能借用额外的业务差异额度');
  }
  assert.deepEqual(expected, original, '已审查的原始字节必须保持不变');
});

test('当前业务控件和其他遮罩不能用于改写基准中的业务内容', () => {
  const expected = picture();
  assert.deepEqual(networkCodeReference(expected, [
    { x: 0, y: 0, width: 100, height: 10, reason: '倒计时' },
  ]), expected);
  const normalized = networkCodeReference(expected, [currentMask]);
  const wrongSize = PNG.sync.write(new PNG({ width: 101, height: 100 }));
  assert.notEqual(comparator(wrongSize, normalized, screenshotComparison), null, '尺寸变化必须失败');
});

test('实际比较保留基准文件并附上参与判定的预期图和失败差异图', async context => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-node-mask-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '牌桌.png');
  const expected = maskScreenshot(picture(), [oldMask]);
  writeFileSync(file, expected);
  const attachments = new Map();
  const info = {
    config: { updateSnapshots: 'none' },
    /** 返回临时基准路径，测试不接触正式图片。 */
    snapshotPath: () => file,
    /**
     * 保存比较附件以核对报告证据。
     * @param name - 附件名称。
     * @param data - 附件正文。
     */
    attach: async (name, data) => attachments.set(name, data.body),
  };
  await expectScreenshot(maskScreenshot(picture(50), [currentMask]), '牌桌', info, [currentMask]);
  assert.deepEqual(attachments.get('牌桌-expected.png'), networkCodeReference(expected, [currentMask]));
  assert.equal(attachments.has('牌桌-diff.png'), false);
  await assert.rejects(expectScreenshot(maskScreenshot(picture(51), [currentMask]), '牌桌', info, [currentMask]),
    /截图必须符合已审查基准及共用差异比例/);
  assert.ok(attachments.get('牌桌-diff.png'), '失败时必须保留真实差异图');
  assert.deepEqual(readFileSync(file), expected, '比较过程不能写入仓库基准');
});
