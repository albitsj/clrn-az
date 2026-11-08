import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { androidGameFiles } from './android-game-scope.mjs';
import { androidAnimationFiles } from './android-animation-scope.mjs';
import { repository } from './source-files.mjs';

/** 使用生产配置、脚本及依赖创建隔离项目，探针不进入共享工作树。
 * @param context - 负责清理临时目录的测试上下文。
 */
function temporaryProject(context) {
  const directory = mkdtempSync(join(tmpdir(), 'android-animation-complexity-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of ['package.json', 'eslint.config.mjs', 'scripts']) {
    cpSync(join(repository, file), join(directory, file), { recursive: true });
  }
  symlinkSync(join(repository, 'node_modules'), join(directory, 'node_modules'), 'dir');
  mkdirSync(join(directory, 'android'));
  for (const pattern of [...androidAnimationFiles, ...androidGameFiles]) {
    writeFileSync(join(directory, pattern.split('*')[0] + 'probe.ts'), 'export const probe = 1;');
  }
  return directory;
}

/** 使用真实生产配置解析探针，不执行其源码。
 * @param source - 探针文本。
 * @param filePath - 对应职责路径。
 */
async function diagnostics(source, filePath) {
  const [result] = await new ESLint().lintText(source, { filePath });
  return result.messages.filter(message => message.ruleId === 'complexity');
}

/** 注册生产路径的测试和工具阈值用例。
 * @param options - 门禁名称及各职责路径。
 */
function thresholdCases(options) {
  for (const file of options.testFiles) {
    test(`${options.name} ${file}：测试及辅助代码 3 通过、4 失败`, async () => {
      assert.equal((await diagnostics('function probe(a) { if(a) return 1; if(a) return 2; }', file)).length, 0);
      assert.equal((await diagnostics('function probe(a) { if(a) return 1; if(a) return 2; if(a) return 3; }', file)).length, 1);
    });
  }
  for (const file of options.toolFiles) {
    test(`${options.name} ${file}：独立工具/根配置 6 通过、7 失败`, async () => {
      const branches = 'if(a) return 1;'.repeat(5);
      assert.equal((await diagnostics(`function probe(a) { ${branches} }`, file)).length, 0);
      assert.equal((await diagnostics(`function probe(a) { ${branches} if(a) return 2; }`, file)).length, 1);
    });
  }
}

const probes = [
  'function outer() { return () => { if(a) return 1; if(b) return 2; if(c) return 3; }; }',
  '/* eslint-disable complexity */ function helper(a) { return a?.b?.c || 0; }',
  'function helper(a = 0) { return a && b || c; }',
  'const helper = { get value() { if(a) return 1; if(b) return 2; if(c) return 3; } };',
  'class Helper { constructor(a = 0) { if(a) return; if(b) return; } }',
];
/** 确认嵌套和行内注释不能绕过原生计数。
 * @param options - 当前测试辅助文件路径。
 */
function syntaxCases(options) {
  for (const source of probes) {
    test(`${options.name} 嵌套、访问器、构造函数、默认值、可选链、短路及禁用注释仍独立计数：${source}`, async () => {
      assert.equal((await diagnostics(source, options.supportFile)).length, 1);
    });
  }

}

/** 使用隔离项目证明真实执行入口及报告模式均失败关闭。
 * @param options - 当前门禁入口与辅助文件。
 */
function entryCases(options) {
  test(`${options.name} 独立门禁及既有 lint:js 入口阻断超限辅助文件，解析错误同样失败`, context => {
    const directory = temporaryProject(context);
    const runOptions = { cwd: directory, encoding: 'utf8' };
    const clean = spawnSync(process.execPath, [options.script], runOptions);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    const path = join(directory, options.supportFile);
    writeFileSync(path, '/* eslint-disable complexity */ function helper(a) { if(a) return 1; if(a) return 2; if(a) return 3; }');
    for (const [command, args] of [[process.execPath, [options.script]], ['npm', ['run', 'lint:js']]]) {
      const result = spawnSync(command, args, runOptions);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(options.supportFile));
      assert.match(result.stderr, /complexity of 4.*Maximum allowed is 3/);
    }
    writeFileSync(path, 'function broken( {');
    const result = spawnSync(process.execPath, [options.script], runOptions);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Parsing error/);
    const report = spawnSync(process.execPath, [options.script, '--report'], runOptions);
    assert.notEqual(report.status, 0);
    assert.match(report.stderr, /无法解析/);
  });

}

/** 缺失依赖必须产生非零退出码。
 * @param options - 当前门禁脚本。
 */
function dependencyCase(options) {
  test(`${options.name} 缺少 ESLint 依赖时入口非零退出`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'android-animation-missing-dependency-'));
    try {
      cpSync(join(repository, 'scripts'), join(directory, 'scripts'), { recursive: true });
      const result = spawnSync(process.execPath, [join(directory, options.script)], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
      assert.match(result.stderr, /Cannot find package 'eslint'/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

/** 为每个独立范围复用同一套生产配置契约。
 * @param options - 名称、脚本和按职责分类的探针路径。
 */
export function complexityContract(options) {
  thresholdCases(options);
  syntaxCases(options);
  entryCases(options);
  dependencyCase(options);
}
