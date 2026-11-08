import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('已审查动画英文帧齐全，其他语言不得保留动画副本', () => {
  const expected = JSON.parse(readFileSync(new URL('./animation-baselines.json', import.meta.url), 'utf8'));
  const root = new URL('./snapshots/', import.meta.url);
  const actual = [];
  for (const directory of readdirSync(root, { withFileTypes: true }).filter(isAndroidDirectory)) {
    actual.push(...readdirSync(new URL(`${directory.name}/`, root)).filter(isAnimation)
      .map(name => `${directory.name}/${name}`));
  }
  assert.ok(expected.length > 0, '动画基准清单不得为空');
  assert.equal(new Set(expected).size, expected.length, '动画基准清单不得重复');
  assert.ok(expected.every(name => /^android-[^/]+-en\/[^/]+\.png$/.test(name)),
    '动画基准清单只接受英文目录');
  assert.deepEqual(actual.sort(), expected,
    '动画基准缺失或混入未登记/非英文截图；新增动画须同步审查清单');
});

/** 只查看原生截图目录。
 * @param directory - 目录项。
 */
function isAndroidDirectory(directory) { return directory.isDirectory() && directory.name.startsWith('android-'); }
/** 历史登录烟测属于普通页面。
 * @param name - 图片文件名。
 */
function isAnimation(name) {
  if (!name.endsWith('.png')) return false;
  if (/^(login-|forgot-password-)/.test(name)) return false;
  return isAnimationName(name);
}
/** 倒计时关键帧保留语言前缀，其余普通页面排除。
 * @param name - PNG 名称。
 */
function isAnimationName(name) {
  return /-countdown-\d+-(first|moved)\.png$/.test(name) || !/^(en|zh-Hans|zh-Hant)-/.test(name);
}
