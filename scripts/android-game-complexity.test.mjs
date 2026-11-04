import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repository } from './source-files.mjs';

/** 使用生产配置、脚本及依赖创建隔离项目，探针不进入共享工作树。
 * @param context - 负责清理临时目录的测试上下文。
 */
function temporaryProject(context) {
  const directory = mkdtempSync(join(tmpdir(), 'android-game-complexity-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of ['package.json', 'eslint.config.mjs', 'scripts']) {
    cpSync(join(repository, file), join(directory, file), { recursive: true });
  }
  symlinkSync(join(repository, 'node_modules'), join(directory, 'node_modules'), 'dir');
  mkdirSync(join(directory, 'android'));
  for (const prefix of ['game', 'texas', 'zhajinhua-gameplay']) {
    writeFileSync(join(directory, 'android', `${prefix}-probe.ts`), 'export const probe = 1;');
  }
  return directory;
}

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

test('独立门禁及既有 lint:js 入口阻断临时超限辅助文件，解析错误同样失败', context => {
  const directory = temporaryProject(context);
  const options = { cwd: directory, encoding: 'utf8' };
  const clean = spawnSync(process.execPath, ['scripts/android-game-complexity.mjs'], options);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  const path = join(directory, 'android/game-probe.ts');
  writeFileSync(path, '/* eslint-disable complexity */ function helper(a) { if(a) return 1; if(a) return 2; if(a) return 3; }');
  for (const [command, args] of [[process.execPath, ['scripts/android-game-complexity.mjs']], ['npm', ['run', 'lint:js']]]) {
    const result = spawnSync(command, args, options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /game-probe\.ts/);
    assert.match(result.stderr, /complexity of 4.*Maximum allowed is 3/);
  }
  writeFileSync(path, 'function broken( {');
  const result = spawnSync(process.execPath, ['scripts/android-game-complexity.mjs'], options);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Parsing error/);
  const report = spawnSync(process.execPath, ['scripts/android-game-complexity.mjs', '--report'], options);
  assert.notEqual(report.status, 0);
  assert.match(report.stderr, /无法解析/);
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
