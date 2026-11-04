import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('已审查动画英文帧齐全，其他语言不得保留动画副本', () => {
  const expected = JSON.parse(readFileSync(new URL('./animation-baselines.json', import.meta.url), 'utf8'));
  const root = new URL('./snapshots/', import.meta.url);
  const actual = [];
  for (const directory of readdirSync(root, { withFileTypes: true })) {
    if (!directory.isDirectory() || !directory.name.startsWith('android-')) continue;
    for (const name of readdirSync(new URL(`${directory.name}/`, root))) {
      // 普通页面带语言前缀；历史登录烟测是普通页面，不参与动画迁移。
      const countdown = /-countdown-\d+-(first|moved)\.png$/.test(name);
      if (!name.endsWith('.png') || (!countdown && /^(en|zh-Hans|zh-Hant)-/.test(name))
        || /^(login-|forgot-password-)/.test(name)) continue;
      actual.push(`${directory.name}/${name}`);
    }
  }
  assert.ok(expected.length > 0, '动画基准清单不得为空');
  assert.equal(new Set(expected).size, expected.length, '动画基准清单不得重复');
  assert.ok(expected.every(name => /^android-[^/]+-en\/[^/]+\.png$/.test(name)),
    '动画基准清单只接受英文目录');
  assert.deepEqual(actual.sort(), expected,
    '动画基准缺失或混入未登记/非英文截图；新增动画须同步审查清单');
});
