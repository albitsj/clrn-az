import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';
import { assertOnlyShrinks, compareFindings } from './lint-ratchet.mjs';
import { intersectBaselines, runJscpd } from './lint-duplicates.mjs';
import { repository } from './source-files.mjs';

const eslint = new ESLint({ cwd: repository, allowInlineConfig: false });

/**
 * 用生产 ESLint 配置检查临时 TypeScript 内容，返回指定规则的诊断。
 * @param source - 临时源码，不写入工作树。
 * @param rule - 待验证的规则。
 * @param filePath - 模拟的项目内路径。
 */
async function diagnostics(source, rule, filePath = 'android/tests/quality-probe.ts') {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(message => message.ruleId === rule);
}

test('真实 ESLint 阈值：复杂度 10、深度 3；行内禁用不能绕过', async () => {
  const branches = Array.from({ length: 10 }, (_, i) => `if (n === ${i}) return ${i};`).join('\n');
  assert.equal((await diagnostics(`// eslint-disable-next-line complexity\nfunction probe(n: number) { ${branches} return -1; }`, 'complexity')).length, 1);
  const nested = 'function probe(n: number) { if(n) { if(n) { if(n) { if(n) { return n; } } } } }';
  assert.equal((await diagnostics(nested, 'max-depth')).length, 1);
  assert.equal((await diagnostics('function probe(n: number) { if(n) { if(n) { if(n) { return n; } } } }', 'max-depth')).length, 0);
  assert.equal((await diagnostics(`function probe(n: number) { ${branches.replace('if (n === 9) return 9;', '')} return -1; }`, 'complexity')).length, 0);
});

test('语法级响应伪造规则覆盖普通、可选、计算属性、别名和解构调用', async () => {
  for (const source of [
    'page.route("**/*", handler);', 'route.fulfill({ body: "fake" });',
    'page?.route("**/*", handler);', 'route["fulfill"]({ body: "fake" });',
    'const install = page.route; install("**/*", handler);',
    'const { fulfill: reply } = route; reply({ body: "fake" });',
    'const { ["route"]: install } = page; install("**/*", handler);',
    'page.routeFromHAR("fake.har");', 'page.routeWebSocket("**/*", handler);',
    'globalThis.fetch = async () => new Response("fake");',
    'globalThis["fetch"] = async () => fakeResponse;',
    'context.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));',
  ]) {
    assert.ok((await diagnostics(source, 'no-restricted-syntax')).length > 0, source);
  }
});

test('注释、文案、URL 和真正请求不误报；例外只适用于登记的适配器单元测试', async () => {
  const real = '// page.route("fake", callback)\nconst text = "route.fulfill"; await fetch("https://example.invalid/route/fulfill"); signal.abort();';
  assert.deepEqual(await diagnostics(real, 'no-restricted-syntax'), []);
  const response = 'const response = new Response("unit"); Response.json({ ok: true });';
  assert.deepEqual(await diagnostics(response, 'no-restricted-syntax', 'visual/cases/_shared/room.test.ts'), []);
  assert.ok((await diagnostics(response, 'no-restricted-syntax', 'visual/cases/_shared/other.test.ts')).length > 0);
  assert.ok((await diagnostics('page.route("**/*", handler);', 'no-restricted-syntax', 'visual/cases/_shared/room.test.ts')).length > 0);
});

test('Ruff C901 读取真实配置，复杂度 11 即失败，noqa 无法隐瞒', () => {
  const branches = Array.from({ length: 10 }, (_, i) => `    if n == ${i}:\n        return ${i}`).join('\n');
  const result = spawnSync('uvx', ['--from', 'ruff==0.15.12', 'ruff', 'check', '--no-cache', '--ignore-noqa',
    '--output-format', 'json', '--stdin-filename', 'android/quality_probe.py', '-'],
  { cwd: repository, input: `def probe(n):  # noqa: C901\n${branches}\n    return -1\n`, encoding: 'utf8' });
  assert.notEqual(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).some(message => message.code === 'C901'));
});

test('精确迁移不能接受新增位置、恶化或清单扩容；已修复项必须删除', () => {
  const known = { tool: 'eslint', file: 'old.ts', rule: 'complexity', line: 2, message: '11 > 10', sourceHash: 'old', reason: '既有分支迁移' };
  assert.deepEqual(compareFindings([known], [known]), { added: [], stale: [] });
  const worsened = { ...known, message: '12 > 10' };
  assert.equal(compareFindings([worsened], [known]).added.length, 1);
  assert.equal(compareFindings([{ ...known, file: 'new.ts' }], [known]).added.length, 1);
  assert.equal(compareFindings([], [known]).stale.length, 1);
  assert.throws(() => assertOnlyShrinks([known, worsened], [known]), /只能缩减/);
  assert.throws(() => assertOnlyShrinks([known, known], [known]), /不能包含重复项/);
  assert.throws(() => assertOnlyShrinks([{ ...known, reason: '改写原因' }], [known]), /只能缩减/);
  assert.doesNotThrow(() => assertOnlyShrinks([], [known]));
});

/**
 * 创建退出测试时自动清理的临时源码目录。
 * @param context - Node 测试上下文。
 */
function temporaryProject(context) {
  const directory = mkdtempSync(join(tmpdir(), 'quality-negative-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * 写入临时负例，所有路径均位于系统临时目录。
 * @param directory - 临时项目目录。
 * @param file - 相对路径。
 * @param source - 文件内容。
 */
function putSource(directory, file, source) {
  const destination = join(directory, file);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, source);
}

/**
 * 在独立临时项目上调用真实 dependency-cruiser 配置。
 * @param directory - 临时源码根。
 */
function cruise(directory) {
  putSource(directory, 'tsconfig.json', '{"compilerOptions":{"moduleResolution":"bundler","module":"ESNext"}}');
  return spawnSync(join(repository, 'node_modules/.bin/depcruise'),
    ['--config', join(repository, '.dependency-cruiser.cjs'), 'android', 'visual'],
    { cwd: directory, encoding: 'utf8' });
}

test('dependency-cruiser 拒绝循环、界面越层与反向依赖，代理适配器可合法导入', context => {
  const directory = temporaryProject(context);
  putSource(directory, 'android/a.ts', 'import { b } from "./b"; export const a = () => b;');
  putSource(directory, 'android/b.ts', 'import { a } from "./a"; export const b = () => a;');
  putSource(directory, 'visual/src/support/networkMocks.ts', 'export const response = {};');
  let result = cruise(directory);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /no-circular/);
  putSource(directory, 'android/b.ts', 'export const b = 1;');
  putSource(directory, 'android/tests/probe.ts', 'import { response } from "../../visual/src/support/networkMocks"; console.log(response);');
  result = cruise(directory);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /ui-no-response-implementation/);
  rmSync(join(directory, 'android/tests'), { recursive: true });
  putSource(directory, 'android/network-routes.ts', 'import { response } from "../visual/src/support/networkMocks"; export const router = response;');
  putSource(directory, 'android/scenarios.test.mjs', 'import { router } from "./network-routes.ts"; console.log(router);');
  assert.equal(cruise(directory).status, 0);
  putSource(directory, 'visual/src/support/networkMocks.ts', 'import { a } from "../../../android/a"; export const response = a;');
  assert.match(cruise(directory).stdout, /response-no-ui/);
});

test('dependency-cruiser 解析仅有 exports 的包，同时拒绝未导出和不存在的依赖', context => {
  const directory = temporaryProject(context);
  putSource(directory, 'visual/entry.ts', 'export const value = 1;');
  putSource(directory, 'node_modules/exports-only/package.json', JSON.stringify({
    name: 'exports-only', type: 'module', exports: { '.': { node: { import: './entry.js' } } },
  }));
  putSource(directory, 'node_modules/exports-only/entry.js', 'export const value = 1;');
  putSource(directory, 'node_modules/exports-only/private.js', 'export const secret = 2;');
  putSource(directory, 'android/probe.mjs', 'import { value } from "exports-only"; console.log(value);');
  const resolved = cruise(directory);
  assert.equal(resolved.status, 0, resolved.stdout + resolved.stderr);
  for (const dependency of ['exports-only/private.js', 'missing-package']) {
    putSource(directory, 'android/probe.mjs', `import value from "${dependency}"; console.log(value);`);
    const unresolved = cruise(directory);
    assert.notEqual(unresolved.status, 0, unresolved.stderr);
    assert.match(unresolved.stdout, /no-unresolved/);
  }
});

test('jscpd 报告旧重复，新增副本失败，删除后的指纹允许量不会回涨', context => {
  const directory = temporaryProject(context);
  const source = Array.from({ length: 12 }, (_, i) => `export const duplicateValue${i} = calculate(${i}, "probe-${i}");`).join('\n') + '\n';
  putSource(directory, 'first.ts', source);
  putSource(directory, 'second.ts', source);
  const baseline = join(directory, 'known.json');
  runJscpd(directory, join(directory, 'before'), ['--baseline', baseline, '--update-baseline']);
  const known = JSON.parse(readFileSync(baseline, 'utf8'));
  assert.ok(Object.keys(known.fingerprints).length > 0, '必须实际发现旧重复，拒绝空跑');
  assert.doesNotThrow(() => runJscpd(directory, join(directory, 'unchanged'), ['--baseline', baseline, '--fail-on-new-clones', '0']));
  putSource(directory, 'third.ts', source);
  assert.throws(() => runJscpd(directory, join(directory, 'after'), ['--baseline', baseline, '--fail-on-new-clones', '0']), /new clones/);
  assert.deepEqual(intersectBaselines(known, { fingerprints: {} }).fingerprints, {});
  assert.deepEqual(intersectBaselines({ fingerprints: { same: 2 } }, { fingerprints: { same: 3, new: 1 } }).fingerprints, { same: 2 });
});

test('已登记的真实房间适配器单元测试没有响应伪造误报', async () => {
  const filePath = 'visual/cases/_shared/room.test.ts';
  assert.deepEqual(await diagnostics(readFileSync(join(repository, filePath), 'utf8'), 'no-restricted-syntax', filePath), []);
});
