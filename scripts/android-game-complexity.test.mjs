import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 使用真实生产配置静态解析探针，关闭行内豁免。
 * @param source - 不执行的探针源码。
 * @param filePath - 探针对应的职责路径。
 */
async function diagnostics(source, filePath) {
  const [result] = await new ESLint().lintText(source, { filePath });
  return result.messages.filter(message => message.ruleId === 'complexity');
}

for (const file of ['android/game-controls.test.mjs', 'android/game-probe.ts', 'android/texas-probe.ts',
  'android/zhajinhua-gameplay-probe.ts', 'scripts/android-game-probe.test.mjs']) {
  test(`${file}：测试及辅助代码 3 通过、4 失败`, async () => {
    assert.equal((await diagnostics('function probe(a) { if(a) return 1; if(a) return 2; }', file)).length, 0);
    assert.equal((await diagnostics('function probe(a) { if(a) return 1; if(a) return 2; if(a) return 3; }', file)).length, 1);
  });
}
for (const file of ['scripts/android-game-probe.mjs', 'eslint.config.mjs']) {
  test(`${file}：独立工具/根配置 6 通过、7 失败`, async () => {
    const branches = 'if(a) return 1;'.repeat(5);
    assert.equal((await diagnostics(`function probe(a) { ${branches} }`, file)).length, 0);
    assert.equal((await diagnostics(`function probe(a) { ${branches} if(a) return 2; }`, file)).length, 1);
  });
}

const probes = [
  'function outer() { return () => { if(a) return 1; if(b) return 2; if(c) return 3; }; }',
  '/* eslint-disable complexity */ function helper(a) { return a?.b?.c || 0; }',
  'function helper(a = 0) { return a && b || c; }',
  'const helper = { get value() { if(a) return 1; if(b) return 2; if(c) return 3; } };',
  'class Helper { constructor(a = 0) { if(a) return; if(b) return; } }',
];
for (const source of probes) {
  test(`嵌套、访问器、构造函数、默认值、可选链、短路及禁用注释仍独立计数：${source}`, async () => {
    assert.equal((await diagnostics(source, 'android/game-probe.ts')).length, 1);
  });
}

test('独立门禁及既有 lint:js 入口阻断临时超限辅助文件，解析错误同样失败', () => {
  const path = `android/game-complexity-probe-${process.pid}.ts`;
  try {
    writeFileSync(path, '/* eslint-disable complexity */ function helper(a) { if(a) return 1; if(a) return 2; if(a) return 3; }');
    for (const [command, args] of [[process.execPath, ['scripts/android-game-complexity.mjs']], ['npm', ['run', 'lint:js']]]) {
      const result = spawnSync(command, args, { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /complexity/);
    }
    writeFileSync(path, 'function broken( {');
    const result = spawnSync(process.execPath, ['scripts/android-game-complexity.mjs'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Parsing error/);
    const report = spawnSync(process.execPath, ['scripts/android-game-complexity.mjs', '--report'], { encoding: 'utf8' });
    assert.notEqual(report.status, 0);
    assert.match(report.stderr, /无法解析/);
  } finally { rmSync(path, { force: true }); }
});

test('缺少 ESLint 依赖时入口非零退出', () => {
  const directory = mkdtempSync(join(tmpdir(), 'android-game-missing-dependency-'));
  try {
    const script = readFileSync('scripts/android-game-complexity.mjs', 'utf8');
    writeFileSync(join(directory, 'check.mjs'), script);
    const result = spawnSync(process.execPath, [join(directory, 'check.mjs'), 'eslint'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.match(result.stderr, /Cannot find package 'eslint'/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
