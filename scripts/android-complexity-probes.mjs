import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { temporaryComplexityProject } from './android-complexity-fixture.mjs';

/** 只解析临时探针，使用真实生产 override。
 * @param source - 静态探针源码。
 * @param filePath - 所属职责路径。
 */
async function diagnostics(source, filePath) {
  const [result] = await new ESLint().lintText(source, { filePath });
  return result.messages.filter(message => message.ruleId === 'complexity');
}

/** 注册每个范围的阈值、绕过和失败传播探针。
 * @param config - 生产门禁及其职责路径。
 */
export function registerComplexityChecks(config) {
  thresholdChecks(config.testPaths, 3);
  thresholdChecks(config.toolPaths, 6);
  syntaxChecks(config.probe);
  entrypointChecks(config);
}

/** 在边界上通过，增加一个分支必须失败。
 * @param paths - 同一预算下的职责路径。
 * @param limit - classic complexity 上限。
 */
function thresholdChecks(paths, limit) {
  for (const file of paths) {
    test(`${file}：${limit} 通过、${limit + 1} 失败`, async () => {
      const branches = 'if(a) return 1;'.repeat(limit - 1);
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

/** 每个嵌套函数、访问器、构造器独立计数，保留所有 classic 语法增量。
 * @param file - 测试辅助职责路径。
 */
function syntaxChecks(file) {
  for (const source of probes) {
    test(`嵌套、默认值、可选链、短路及禁用注释仍独立计数：${source}`, async () => {
      assert.equal((await diagnostics(source, file)).length, 1);
    });
  }
}

/** 验证独立脚本和现有 lint:js 入口实际失败，而非只检查配置数据。
 * @param config - 当前范围的入口和临时辅助路径。
 */
function entrypointChecks(config) {
  test('独立门禁及 lint:js 阻断超限辅助文件，解析错误同样失败', context => {
    const directory = temporaryComplexityProject(context, config);
    const options = { cwd: directory, encoding: 'utf8' };
    const script = `scripts/${config.name}-complexity.mjs`;
    const clean = spawnSync(process.execPath, [script], options);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    const path = join(directory, config.probe);
    writeFileSync(path, '/* eslint-disable complexity */ function helper(a) { if(a) return 1; if(a) return 2; if(a) return 3; }');
    for (const [command, args] of [[process.execPath, [script]], ['npm', ['run', 'lint:js']]]) {
      const result = spawnSync(command, args, options);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(config.probe.split('/').at(-1)), result.stderr);
      assert.match(result.stderr, /complexity of 4.*Maximum allowed is 3/);
    }
    assertParseFailure(path, script, options);
  });
  missingDependencyCheck(config);
}

/** 正常和逐函数报告模式均拒绝解析失败。
 * @param path - 临时探针路径。
 * @param script - 生产门禁入口。
 * @param options - 隔离项目运行选项。
 */
function assertParseFailure(path, script, options) {
  writeFileSync(path, 'function broken( {');
  const result = spawnSync(process.execPath, [script], options);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Parsing error/);
  const report = spawnSync(process.execPath, [script, '--report'], options);
  assert.notEqual(report.status, 0);
  assert.match(report.stderr, /无法解析/);
}

/** 缺少 ESLint 时必须非零退出，不接受空报告。
 * @param config - 生产入口名称。
 */
function missingDependencyCheck(config) {
  test('缺少 ESLint 依赖时入口非零退出', context => {
    const directory = mkdtempSync(join(tmpdir(), 'android-complexity-missing-'));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    for (const file of [`${config.name}-complexity.mjs`, `${config.name}-scope.mjs`, 'android-game-complexity.mjs', 'android-game-scope.mjs', 'shared-complexity-runner.mjs']) {
      writeFileSync(join(directory, file), readFileSync(`scripts/${file}`, 'utf8'));
    }
    const result = spawnSync(process.execPath, [join(directory, `${config.name}-complexity.mjs`)], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.match(result.stderr, /Cannot find package 'eslint'/);
  });
}
