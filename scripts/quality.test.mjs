import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { assertInitialFindings, assertOnlyShrinks, compareFindings, historicalFindings } from './lint-ratchet.mjs';
import { intersectBaselines, runJscpd } from './lint-duplicates.mjs';
import { initialRevision } from './quality-history.mjs';
import { repository } from './source-files.mjs';

const eslint = new ESLint({ cwd: repository, allowInlineConfig: false });
const networkRules = ['no-restricted-syntax', 'quality/no-network-responses', 'quality/no-network-routing'];

test('首次迁移逐项对照固定主分支的真实测量，拒绝同位置恶化和虚构旧环', () => {
  const original = JSON.parse(readFileSync(join(repository, 'quality/measurements', initialRevision, 'eslint.json'), 'utf8'));
  const known = original.find(entry => entry.rule === 'complexity');
  assert.doesNotThrow(() => assertInitialFindings([{ ...known, reason: '固定主分支已有违规' }], original));
  assert.throws(() => assertInitialFindings([{ ...known, message: '复杂度进一步增大' }], original), /不在固定主分支/);
  const cycles = JSON.parse(readFileSync(join(repository, 'quality/measurements', initialRevision, 'dependency-cruiser.json'), 'utf8'));
  const invented = { ...cycles[0], cycle: ['android/device.ts', 'android/screenshot.ts'] };
  assert.throws(() => assertInitialFindings([invented], cycles), /不在固定主分支/);
});

test('独立扫描固定主分支可重现归档报告，路径不依赖临时目录别名', async () => {
  for (const tool of ['eslint', 'ruff', 'dependency-cruiser']) {
    const saved = JSON.parse(readFileSync(join(repository, 'quality/measurements', initialRevision, `${tool}.json`), 'utf8'));
    assert.deepEqual(await historicalFindings(tool, initialRevision), saved, `固定主分支的 ${tool} 测量必须可重现`);
  }
});

test('首次接入拒绝把旧主分支提交作为自动测试比较基准', () => {
  const result = spawnSync(process.execPath, ['scripts/lint-ratchet.mjs', 'eslint'], {
    cwd: repository, encoding: 'utf8', env: { ...process.env, QUALITY_BASE_REV: '24e46865d9f36075915d81360c495381564d7e95' },
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /首次门禁必须对照固定的最新主分支/);
});

/**
 * 用生产 ESLint 配置检查临时 TypeScript 内容，返回指定规则的诊断。
 * @param source - 临时源码，不写入工作树。
 * @param rule - 待验证的规则。
 * @param filePath - 模拟的项目内路径。
 */
async function diagnostics(source, rule, filePath = 'android/tests/quality-probe.ts') {
  const [result] = await eslint.lintText(source, { filePath });
  assert.ok(!result.messages.some(message => message.fatal), JSON.stringify(result.messages));
  return result.messages.filter(message => [rule].flat().includes(message.ruleId));
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
    assert.ok((await diagnostics(source, networkRules)).length > 0, source);
  }
});

test('注释、文案、URL 和真正请求不误报；例外只适用于登记的适配器单元测试', async () => {
  const real = '// page.route("fake", callback)\nconst text = "route.fulfill"; await fetch("https://example.invalid/route/fulfill"); signal.abort();';
  assert.deepEqual(await diagnostics(real, networkRules), []);
  const response = 'const response = new Response("unit"); Response.json({ ok: true });';
  assert.deepEqual(await diagnostics(response, networkRules, 'visual/cases/_shared/room.test.ts'), []);
  assert.ok((await diagnostics(response, networkRules, 'visual/cases/_shared/other.test.ts')).length > 0);
  assert.ok((await diagnostics('page.route("**/*", handler);', networkRules, 'visual/cases/_shared/room.test.ts')).length > 0);
});

test('属性 API 替换 fetch 和计算属性 Response.json 分别失败，精确适配器例外保留', async () => {
  const sources = [
    'Object.assign(globalThis, { fetch: fakeFetch });',
    'Object["assign"](window, { ["fetch"]: fakeFetch });',
    'Object.assign?.(self, { fetch: fakeFetch });',
    'Object.defineProperty(globalThis, "fetch", { value: fakeFetch });',
    'Object["defineProperty"](window, "fetch", { value: fakeFetch });',
    'Reflect.defineProperty(globalThis, "fetch", { value: fakeFetch });',
    'Reflect["defineProperty"](self, "fetch", { get: getFakeFetch });',
    'Object.defineProperties(globalThis, { fetch: { value: fakeFetch } });',
    'Object["defineProperties"](global, { ["fetch"]: { get: getFakeFetch } });',
    'Response["json"]({ fake: true });',
    'Response?.["json"]({ fake: true });',
    'const reply = Response["json"]; reply({ fake: true });',
    'Object.assign(globalThis, { fetch: /** 返回伪造响应。 */ async () => Response["json"]({ fake: true }) });',
    'Object.defineProperty(globalThis, "fetch", { value: /** 返回伪造响应。 */ async () => Response["json"]({ fake: true }) });',
  ];
  for (const filePath of ['android/tests/quality-probe.spec.ts', 'visual/cases/quality-probe.spec.ts',
    'e2e/tests/quality-probe.spec.ts', 'visual/cases/_shared/other.test.ts']) {
    for (const source of sources) {
      assert.ok((await diagnostics(source, networkRules, filePath)).length > 0, `${filePath}: ${source}`);
    }
  }
  for (const source of sources) {
    assert.deepEqual(await diagnostics(source, networkRules, 'visual/cases/_shared/room.test.ts'), [], source);
  }
});

test('属性 API 的普通数据操作及字符串不会触发网络伪造规则', async () => {
  const source = `
    Object.assign(settings, { label: "fetch", text: 'Response["json"]', payload: { fetch: "data" } });
    Object.defineProperty(settings, "label", { value: "fetch" });
    Object.defineProperties(settings, { label: { value: "fetch" } });
    Reflect.defineProperty(settings, "label", { value: "fetch" });
    Object.assign(settings, { [fetch]: "dynamic data" });
    Object[assign](settings, { fetch: "dynamic method" });
    await fetch("https://example.invalid/json");
    const payload = { fetch: "data", json: "text" };
  `;
  assert.deepEqual(await diagnostics(source, networkRules), []);
});

/**
 * 在普通路径矩阵和精确离线适配器路径上验证独立入口。
 * @param sources - 每个片段只含一个待禁止入口，不执行源码。
 */
async function assertResponseGate(sources) {
  for (const source of sources) {
    for (const filePath of ['android/tests/quality-probe.spec.ts', 'visual/cases/quality-probe.spec.ts',
      'e2e/tests/quality-probe.spec.ts', 'visual/cases/_shared/other.test.ts', 'visual/cases/_shared/room.test.mts']) {
      const messages = await diagnostics(source, 'quality/no-network-responses', filePath);
      assert.equal(messages.length, 1, `${filePath}: ${source}`);
      assert.equal(messages[0].severity, 2);
    }
    assert.deepEqual(await diagnostics(source, networkRules, 'visual/cases/_shared/room.test.ts'), [], source);
  }
}

test('needs-repair 原始反例通过 TypeScript 检查后，独立生产规则均报错', async () => {
  const probes = [
    ['Reflect.set(globalThis, "fetch", /** fake reply */ async () => globalThis.Response.json({ fake: true }));', 2],
    ['const { ["json"]: reply } = globalThis.Response; const fabricated = reply.call(Response, { fake: true }); void fabricated;', 1],
    ['declare const page: import("@playwright/test").Page; void (/** 伪造网络响应。 */ async () => { await page[`route`]("**/*", /** 返回伪造响应。\n * @param route - 路由控制器。\n */ async route => { await route[`fulfill`]({status:200,body:"fake"}); }); })();', 2],
  ];
  let source;
  const file = join(repository, 'android/tests/quality-compiled-probe.ts');
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: ['node'],
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  /**
   * 仅将探针源码放入内存，其余类型库仍由真实编译器读取。
   * @param name - 编译器请求的文件名。
   * @param languageVersion - 编译器解析选项。
   * @param rest - 传给原始宿主的其他读取选项。
   */
  host.getSourceFile = (name, languageVersion, ...rest) => name === file
    ? ts.createSourceFile(name, source, languageVersion, true) : readSource(name, languageVersion, ...rest);
  for (const [probe, count] of probes) {
    source = probe;
    assert.deepEqual(ts.getPreEmitDiagnostics(ts.createProgram([file], options, host)), []);
    for (const filePath of ['android/tests/quality-probe.spec.ts', 'visual/cases/quality-probe.spec.ts',
      'e2e/tests/quality-probe.spec.ts', 'visual/cases/_shared/room.test.tsx']) {
      assert.equal((await diagnostics(source, networkRules, filePath)).length, count, filePath);
    }
  }
  for (const [probe] of probes.slice(0, 2)) {
    assert.deepEqual(await diagnostics(probe, networkRules, 'visual/cases/_shared/room.test.ts'), []);
  }
});

test('静态属性 API 族独立阻止 fetch 替换：点访问、固定计算键、全局对象和透明包装', async () => {
  const sources = [];
  for (const target of ['globalThis', 'window', 'self', 'global']) {
    for (const method of ['Reflect.set', 'Reflect["set"]', 'Reflect[`set`]',
      'Object.defineProperty', 'Object["defineProperty"]', 'Object[`defineProperty`]',
      'Reflect.defineProperty', 'Reflect["defineProperty"]', 'Reflect[`defineProperty`]']) {
      for (const key of ['"fetch"', '`fetch`', '(("fetch" as const)!)', '("fetch" satisfies string)']) {
        sources.push(`${method}((${target} as typeof ${target}), ${key}, ${method.includes('set') ? 'fetch' : '{ value: fetch }'});`);
      }
    }
    for (const method of ['assign', 'defineProperties']) {
      for (const access of [`.${method}`, `["${method}"]`, `[\`${method}\`]`]) {
        sources.push(`(Object${access})!(${target}, ({ [(\`fetch\` satisfies string)]: ${method === 'assign' ? 'fetch' : '{ value: fetch }'} } as const));`);
      }
    }
    sources.push(`(${target} as typeof ${target})[("fetch" as const)!] = fetch;`);
    sources.push(`globalThis.Reflect[\`set\`](${target}, \`fetch\`, fetch);`);
    sources.push(`(Object.assign<typeof ${target}, { fetch: typeof fetch }>)(${target}, { fetch });`);
  }
  sources.push('(Reflect as typeof Reflect)[("set" as const)]!(globalThis!, (`fetch` as const), fetch);');
  sources.push('(<typeof Reflect>Reflect)[`set`](globalThis, `fetch`, fetch);');
  sources.push('Reflect?.[`set`]?.(globalThis, `fetch`, fetch);');
  sources.push('Object.assign(client, { fetch: fakeFetch });');
  sources.push('Object.defineProperty(client, "fetch", { value: fakeFetch });');
  sources.push('Object.defineProperties(client, { fetch: { value: fakeFetch } });');
  sources.push('Reflect.defineProperty(client, "fetch", { value: fakeFetch });');
  sources.push('client.fetch = fakeFetch;');
  sources.push('context.mock[`method`](globalThis, (`fetch` as const), fakeFetch);');
  await assertResponseGate(sources);
});

test('Response 入口独立失败：全局限定、固定计算键和透明包装，不依赖 fetch 替换', async () => {
  const sources = [];
  for (const root of ['', 'globalThis', 'window', 'self', 'global']) {
    const constructors = root ? [root + '.Response', `${root}["Response"]`, `${root}[\`Response\`]`,
      `(${root} as typeof ${root})[("Response" as const)!]`] : ['Response'];
    for (const constructor of constructors) {
      sources.push(`new (${constructor})("fake");`);
      for (const key of ['json', '"json"', '["json"]', '[`json`]', '[("json" as const)!]', '[(`json` satisfies string)]']) {
        sources.push(`const { ${key}: reply } = (${constructor} as typeof Response)!; void reply;`);
        sources.push(`let reply; ({ ${key}: reply } = (${constructor} satisfies typeof Response));`);
        sources.push(`function probe({ ${key}: reply } = ${constructor}) { return reply; }`);
      }
      for (const key of ['.json', '["json"]', '[`json`]', '[("json" as const)!]', '[(`json` satisfies string)]']) {
        sources.push(`(${constructor} as typeof Response)${key}({ fake: true });`);
        sources.push(`const reply = (${constructor})!${key}; void reply;`);
      }
    }
  }
  sources.push('globalThis?.["Response"]?.[`json`]?.({ fake: true });');
  sources.push('(<typeof Response>globalThis.Response)[`json`]({ fake: true });');
  await assertResponseGate(sources);
});

test('属性 API 业务数据、相似名称、动态键和文案不会误报，例外继续禁止路由伪造', async () => {
  const source = `
    // Reflect.set(globalThis, "fetch", fakeFetch); globalThis.Response.json({ fake: true });
    const text = 'globalThis.Response.json';
    const payload = { fetch: "business data", Response: { json: "data" } };
    Object.assign(settings, payload, { label: "fetch" });
    Object.defineProperties(settings, { label: { value: "fetch" } });
    Reflect.set(settings, "fetch", "data"); settings.label = "fetch";
    Object.assign(globalThis, { payload: { fetch: "data" } });
    Reflect[\`set\`](globalThis, \`prefetch\`, "data");
    Reflect.set(globalThis, key, fetch); Reflect[method](globalThis, "fetch", fetch);
    Reflect.set(globalThis, \`fetch\${suffix}\`, fetch);
    Reflector.set(globalThis, "fetch", fetch); MyObject.assign(globalThis, { fetch });
    business.Response.json(payload); globalThis.MyResponse.json(payload);
    Response[method](payload); Response[\`json\${suffix}\`](payload); CustomResponse.json(payload);
    Object.assign(globalThis, { [key]: fetch });
    await fetch("https://example.invalid/json");
  `;
  for (const filePath of ['android/tests/quality-probe.spec.ts', 'visual/cases/quality-probe.spec.ts', 'e2e/tests/quality-probe.spec.ts']) {
    assert.deepEqual(await diagnostics(source, networkRules, filePath), [], filePath);
  }
  assert.ok((await diagnostics('page.route("**/*", handler);', networkRules, 'visual/cases/_shared/room.test.ts')).length > 0);
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
  assert.deepEqual(await diagnostics(readFileSync(join(repository, filePath), 'utf8'), networkRules, filePath), []);
});
