import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { repository } from './source-files.mjs';

const eslint = new ESLint({ allowInlineConfig: false });
const ordinaryPaths = ['android/tests/quality-probe.spec.ts', 'visual/cases/quality-probe.spec.ts',
  'e2e/tests/quality-probe.spec.ts'];
const adapter = 'visual/cases/_shared/room.test.ts';
const responseRule = 'quality/no-network-responses';
const routingRule = 'quality/no-network-routing';
const fake = '/** 返回伪造响应。 */ async () => ({ ok: true, status: 200 } as Response)';

/**
 * 只解析内存探针，使用生产配置并排除解析失败。
 * @param source - 不执行的源码。
 * @param filePath - 实际规则范围路径。
 */
async function networkMessages(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  assert.ok(!result.messages.some(message => message.fatal), JSON.stringify(result.messages));
  return result.messages.filter(message => [responseRule, routingRule].includes(message.ruleId));
}

/**
 * 普通路径及精确离线例外分别核对数量与规则，避免别的禁令掩盖缺口。
 * @param source - 探针源码。
 * @param count - 普通路径预期错误数。
 * @param rule - 唯一预期规则。
 */
async function assertMatrix(source, count, rule = responseRule) {
  for (const path of [...ordinaryPaths, adapter]) {
    const messages = await networkMessages(source, path);
    const expected = path === adapter && rule === responseRule ? 0 : count;
    assert.equal(messages.length, expected, `${path}: ${source}\n${JSON.stringify(messages)}`);
    assert.ok(messages.every(message => message.ruleId === rule && message.severity === 2));
  }
}

/**
 * 真实 strict/noEmit 编译只替换一个内存源码文件，类型库来自锁定依赖。
 * @param probes - 每个探针必须独立类型有效。
 */
function assertTypeScript(probes) {
  let source;
  const file = join(repository, 'android/tests/quality-projection-probe.ts');
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: ['node'],
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  /**
   * 在内存中提供源码，不写入项目文件或执行探针。
   * @param name - 文件路径。
   * @param version - 语言版本。
   * @param rest - 原宿主的其他参数。
   */
  host.getSourceFile = (name, version, ...rest) => name === file
    ? ts.createSourceFile(name, source, version, true) : original(name, version, ...rest);
  for (const probe of probes) {
    source = probe;
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
    assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), [], source);
  }
}

test('needs-repair 的 11 组有效核心探针通过真实 TypeScript 并按语义报告', async () => {
  const probes = [
    [`({ fetch: globalThis.fetch } = { fetch: ${fake} });`, 1],
    [`([{ handler: globalThis.fetch }] = [{ handler: ${fake} }]);`, 1],
    [`for (globalThis.fetch of [${fake}]) { console.log("replaced"); }`, 1],
    ['const settings={nested:{route:"business"}};const {nested}=settings;console.log(nested.route);', 0],
    ['const settings={nested:{route:"business"}};const {nested:projected}=settings;console.log(projected.route);', 0],
    ['const [settings]=[{route:"business"}];console.log(settings.route);', 0],
    ['const settings={route:"business"};const {...copy}=settings;console.log(copy.route);', 0],
    ['const settings={route:-1};console.log(settings.route);', 0],
    ['const actual=globalThis.fetch;void actual;', 0],
    [`globalThis.fetch=${fake};`, 1],
    ['const settings={nested:{route:"business"}};console.log(settings.nested.route);', 0],
  ];
  assertTypeScript(probes.map(([source]) => source));
  for (const [source, count] of probes) await assertMatrix(source, count);
});

test('实际写入槽位覆盖全局对象、静态键、包装、嵌套、默认值、剩余项及循环', async () => {
  const probes = [];
  for (const root of ['globalThis', 'window', 'self', 'global']) {
    for (const member of ['.fetch', '["fetch"]', '[`fetch`]', '[("fetch" as const)!]']) {
      const target = `(${root} as typeof ${root})!${member}`;
      probes.push(`({ fetch: ${target} } = { fetch: ${fake} });`);
      probes.push(`([{ handler: ${target} }] = [{ handler: ${fake} }]);`);
      probes.push(`({ fetch: ${target} = ${fake} } = {});`);
      probes.push(`for (${target} of [${fake}]) { void 0; }`);
      probes.push(`for ({ handler: ${target} } of [{ handler: ${fake} }]) { void 0; }`);
    }
  }
  // 剩余结果不能赋给函数类型，用类型有效的未知成员核对实际目标。
  probes.push('declare const client: {fetch: object}; ({ ...client.fetch } = {});');
  probes.push('declare const client: {fetch: unknown[]}; [...client.fetch] = [];');
  // for-in 的 fetch 函数目标类型不合法，改用类型有效的可写任意成员测试相同 AST 入口。
  probes.push('declare const client: Record<string, unknown>; for (client.fetch in {}) { void 0; }');
  assertTypeScript(probes);
  for (const source of probes) await assertMatrix(source, 1);
});

test('写入遍历不会把计算键、默认值、右值和普通 fetch 引用误当替换', async () => {
  const probes = [
    'let actual; ({ actual = globalThis.fetch } = {}); void actual;',
    'let actual; ({ [globalThis.fetch.name]: actual } = { fetch: "data" }); void actual;',
    'let actual; [actual = globalThis.fetch] = []; void actual;',
    'let actual; ({ actual } = { actual: globalThis.fetch }); void actual;',
    'const actual = globalThis.fetch; void actual;',
    'let actual; for (actual of [globalThis.fetch]) { void actual; }',
    'const settings = { fetch: "data" }; ({ value: settings.fetch } = { value: "updated" });',
  ];
  for (const source of probes) await assertMatrix(source, 0);
});

test('纯数据投影保留真实字段的对象、数组、嵌套、重命名、默认值和剩余属性来源', async () => {
  for (const field of ['route', 'fulfill', 'routeFromHAR', 'routeWebSocket', 'fetch', 'json']) {
    const probes = [
      `const settings={nested:{${field}:"business"}}; const {nested: projected}=settings; console.log(projected.${field});`,
      `const {nested: {deep: projected}}={nested:{deep:{${field}:-1}}}; console.log(projected?.[\`${field}\`]);`,
      `const [,{nested: projected}]=[null,{nested:{${field}:true}}]; console.log(projected["${field}"]);`,
      `const [,...rest]=[null,{${field}:null}]; const [projected]=rest; console.log(projected.${field});`,
      `const {omit,...projected}={omit:1,${field}:"data"}; console.log(projected.${field});`,
      `const {missing: projected={${field}:"default"}}={}; console.log(projected.${field});`,
      `const [projected={${field}:false}]=[]; console.log(projected.${field});`,
      `const {nested: {projected={${field}:+1}}={}}={}; console.log(projected.${field});`,
      `const {nested: projected={${field}:"default"}}={nested:{${field}:"actual"}}; console.log(projected.${field});`,
      `const {nested: {${field}: label}={${field}:handler}}={nested:{${field}:"actual"}}; console.log(label);`,
      `const [{...projected}]=[{${field}:"data"}]; console.log(projected.${field});`,
      `const settings={nested:{${field}:"data"}}; const {nested}=settings; const {${field}: label}=nested; console.log(label);`,
      `const [{${field}: label}]=[{${field}:"data"}]; console.log(label);`,
    ];
    for (const source of probes) await assertMatrix(source, 0);
  }
  assertTypeScript([
    'const {nested: {projected={route:+1}}={}}={}; console.log(projected.route);',
    'const [,...rest]=[null,{route:"data"}]; const [projected]=rest; console.log(projected!.route);',
    'const {omit,...projected}={omit:1,route:"data"}; console.log(projected.route);',
  ]);
});

test('未知或有代码的来源、重赋值、未知调用及默认值不能获得纯数据例外', async () => {
  const probes = [
    'const {nested: projected={route:"default"}}=unknown; projected.route;',
    'const [projected={route:"default"}]=unknown; projected.route;',
    'const {nested: projected}=factory(); projected.route;',
    'const {nested: projected}={nested:{route:handler}}; projected.route;',
    'const {nested: projected}={get nested(){throw new Error("never execute");}}; projected.route;',
    'const {nested: projected}={nested:{get route(){throw new Error("never execute");}}}; projected.route;',
    'let {nested: projected}={nested:{route:"data"}}; projected=page; projected.route;',
    'const {nested: projected}={nested:{route:"data"}}; change(projected); projected.route;',
    'const {nested: projected}={nested:{route:"data"}}; projected.route=handler; projected.route;',
    'const settings={nested:{route:"data"}}; change(settings); const {nested: projected}=settings; projected.route;',
    'const settings={nested:{route:"data"}}; const {nested: projected}=settings; change(projected); settings.nested.route;',
    'const settings={route:"data"}; ({value:settings.route}={value:handler}); settings.route;',
    'const settings={route:"data"}; ({value:settings.route=handler}={}); settings.route;',
    'const settings={route:"data"}; for(settings.route of [handler]){void 0;} settings.route;',
    'const settings={}; const {constructor: projected}=settings; projected.route;',
    'const {missing: {route: alias}={route:handler}}={}; void alias;',
    'const {missing: projected={route:handler}}={}; projected.route;',
    'const [{missing: {route: alias}=factory()}]=[{}]; void alias;',
  ];
  for (const source of probes) {
    for (const path of [...ordinaryPaths, adapter]) {
      assert.ok((await networkMessages(source, path)).some(message => message.ruleId === routingRule), `${path}: ${source}`);
    }
  }
});

test('needs-repair 默认值反例与配对控制通过真实 TypeScript 并只判断实际取值', async () => {
  const fallback = 'declare const fallback: import("@playwright/test").Page["route"];';
  const probes = [
    [`${fallback} const {route=fallback}: {route?:typeof fallback}={}; void route;`, 1],
    ['const {route=/** 代码默认值。 */ async()=>undefined}={}; void route;', 1],
    [`${fallback} const {route=fallback}: {route?:string|typeof fallback}={route:"business"}; console.log(route);`, 0],
    ['declare const fallback: ()=>void; const {route,label=fallback}: {route:string,label?:typeof fallback}={route:"business"}; console.log(route,label);', 0],
  ];
  assertTypeScript(probes.map(([source]) => source));
  for (const [source, count] of probes) await assertMatrix(source, count, routingRule);
});

test('路由默认值投影覆盖四种方法、静态键、包装及声明赋值嵌套矩阵', async () => {
  for (const method of ['route', 'fulfill', 'routeFromHAR', 'routeWebSocket']) {
    const owner = method === 'fulfill' ? 'Route' : 'Page';
    const fallback = `declare const fallback: import("@playwright/test").${owner}["${method}"];`;
    const optional = `{${method}?: string|typeof fallback}`;
    const probes = [];
    for (const key of [method, `["${method}"]`, `[\`${method}\`]`, `[("${method}" as const)!]`]) {
      probes.push(
        [`${fallback} const {${key}:reply=fallback}: ${optional}={}; void reply;`, 1],
        [`${fallback} let reply; ({${key}:reply=fallback}=({} as ${optional})!); void reply;`, 1],
        [`${fallback} const {nested:{${key}:reply=fallback}}: {nested:${optional}}={nested:{}}; void reply;`, 1],
        [`${fallback} let reply; ([{nested:{${key}:reply=fallback}}]=[{nested:({} as ${optional})!}]); void reply;`, 1],
        [`${fallback} const {nested:{${key}:reply=fallback}={}}: {nested?:${optional}}={}; void reply;`, 1],
        [`const {${key}:reply=/** 代码默认值。 */ async()=>undefined}={}; void reply;`, 1],
        [`${fallback} const {${key}:reply=fallback}: ${optional}={${method}:"business"}; console.log(reply);`, 0],
        [`${fallback} let reply; ({${key}:reply=fallback}=({${method}:"business"} as ${optional})!); console.log(reply);`, 0],
        [`${fallback} const {nested:{${key}:reply=fallback}}: {nested:${optional}}={nested:{${method}:"business"}}; console.log(reply);`, 0],
        [`${fallback} const {${key}:reply,label=fallback}: {${method}:string,label?:typeof fallback}={${method}:"business"}; console.log(reply,label);`, 0],
        [`${fallback} let reply,label; ([{${key}:reply,label=fallback}]=[{${method}:"business"} as {${method}:string,label?:typeof fallback}]); console.log(reply,label);`, 0],
        [`const {${key}:reply="data"}={}; console.log(reply);`, 0],
        [`const {${key}:reply=null}={}; console.log(reply);`, 0],
      );
    }
    // 每种语法形态独立通过真实编译；其余静态键由生产解析器的路径矩阵验证。
    assertTypeScript(probes.slice(0, 13).map(([source]) => source));
    for (const [source, count] of probes) await assertMatrix(source, count, routingRule);
  }
});

test('needs-repair 删除属性后不能以初始化快照跳过路由函数默认值', async () => {
  const probes = [];
  for (const method of ['route', 'fulfill', 'routeFromHAR', 'routeWebSocket']) {
    const owner = method === 'fulfill' ? 'Route' : 'Page';
    const prefix = `declare const fallback: import("@playwright/test").${owner}["${method}"];
      const settings: {${method}?: string|typeof fallback}={${method}:"business"};`;
    for (const member of [`.${method}`, `["${method}"]`, `[\`${method}\`]`, `[("${method}" as const)!]`]) {
      probes.push(`${prefix} delete (settings as typeof settings)!${member};
        const {[\`${method}\`]:reply=fallback}=settings; void reply;`);
    }
    const controls = [
      `${prefix} const {${method}:reply=fallback}=settings; console.log(reply);`,
      `${prefix} delete settings.${method}; const {${method}:reply="data"}=settings; console.log(reply,fallback);`,
    ];
    assertTypeScript(controls);
    for (const source of controls) {
      for (const filePath of [...ordinaryPaths, adapter]) {
        const [result] = await eslint.lintText(source, { filePath });
        assert.deepEqual(result.messages, [], `${filePath}: ${source}`);
      }
    }
    await assertMatrix(`${prefix} const {${method}:reply=fallback}: typeof settings={}; void reply;`, 1, routingRule);
  }
  assertTypeScript(probes);
  for (const source of probes) await assertMatrix(source, 1, routingRule);
});

test('纯数据变更使属性快照失效：成员写入、静态属性 API、共享别名及嵌套解构', async () => {
  const prefix = `declare const fallback: import("@playwright/test").Page["route"];
    const settings: {nested:{route?:string|typeof fallback}}={nested:{route:"business"}};`;
  const changes = [
    'delete settings.nested.route;',
    'if (Math.random()>0.5) delete settings.nested.route;',
    'const alias=settings.nested; delete alias.route;',
    'const {nested:alias}=settings; delete alias.route;',
    'const [alias]=[settings.nested]; delete alias!.route;',
    'settings.nested={};',
    '({next:settings.nested}={next:{}});',
    'Object.assign(settings,{nested:{}});',
    'Object["defineProperty"](settings,"nested",{value:{}});',
    'Object[`defineProperties`](settings,{nested:{value:{}}});',
    'Reflect[("defineProperty" as const)!](settings,"nested",{value:{}});',
    'Reflect[`set`](settings,"nested",{});',
    'Reflect[`deleteProperty`](settings.nested,"route");',
  ];
  const probes = changes.map(change => `${prefix} ${change}
    const {nested:{route:reply=fallback}}=settings; void reply;`);
  assertTypeScript(probes);
  for (const source of probes) await assertMatrix(source, 1, routingRule);
  // 数组容器、剩余属性和赋值解构使用同一失效状态；不执行循环或删除代码。
  const projections = [
    `${prefix} const {nested:alias}=settings; delete settings.nested.route;
      let reply; ({route:reply=fallback}=alias); void reply;`,
    `${prefix} const {...copy}=settings; delete copy.nested.route;
      const {nested:{route:reply=fallback}}=settings; void reply;`,
    `declare const fallback: import("@playwright/test").Page["route"];
      const settings: {route?: string|typeof fallback}[]=[{route:"business"}];
      delete settings[0]!.route; const [{route:reply=fallback}]=settings; void reply;`,
  ];
  assertTypeScript(projections);
  for (const source of projections) await assertMatrix(source, 1, routingRule);
});
