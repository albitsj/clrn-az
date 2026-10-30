import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ allowInlineConfig: false });
const ordinaryPaths = ['android/tests/quality-probe.spec.ts', 'visual/cases/quality-probe.spec.ts',
  'e2e/tests/quality-probe.spec.ts', 'visual/cases/_shared/other.test.ts', 'visual/cases/_shared/room.test.mts'];
const adapterPath = 'visual/cases/_shared/room.test.ts';
const routingRule = 'quality/no-network-routing';

/**
 * 使用完整生产配置检查内存源码，禁止解析失败造成假通过。
 * @param source - 不会执行的探针。
 * @param filePath - 决定实际规则及精确例外的路径。
 */
async function lint(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  assert.ok(!result.messages.some(message => message.fatal), JSON.stringify(result.messages));
  return result.messages;
}

/**
 * 检查单个路由入口独立失败，包括享有 Response 例外的离线适配器。
 * @param source - 只含一个路由违规、不含 Response 或 fetch 违规的源码。
 */
async function assertRoutingGate(source) {
  for (const filePath of [...ordinaryPaths, adapterPath]) {
    const messages = (await lint(source, filePath)).filter(message => message.ruleId === routingRule);
    assert.equal(messages.length, 1, `${filePath}: ${source}`);
    assert.equal(messages[0].severity, 2);
  }
}

test('路由静态语法族：四种方法的调用、成员读取和别名提取保持独立禁令', async () => {
  for (const method of ['route', 'fulfill', 'routeFromHAR', 'routeWebSocket']) {
    for (const member of [`.${method}`, `["${method}"]`, `[\`${method}\`]`,
      `[("${method}" as const)!]`, `[(\`${method}\` satisfies string)]`]) {
      await assertRoutingGate(`(page as import("@playwright/test").Page)!${member}(payload);`);
      await assertRoutingGate(`const extracted = (page!)${member}; void extracted;`);
    }
    await assertRoutingGate(`page?.[\`${method}\`]?.(payload);`);
    await assertRoutingGate(`(<import("@playwright/test").Page>page)[\`${method}\`];`);
    await assertRoutingGate(`(page[\`${method}\`]<string>)(payload);`);
  }
});

test('路由静态解构：声明、赋值、默认值和参数均不受离线 Response 例外影响', async () => {
  for (const method of ['route', 'fulfill', 'routeFromHAR', 'routeWebSocket']) {
    for (const key of [method, `"${method}"`, `["${method}"]`, `[\`${method}\`]`,
      `[("${method}" as const)!]`, `[(\`${method}\` satisfies string)]`]) {
      await assertRoutingGate(`const { ${key}: extracted } = page; void extracted;`);
      await assertRoutingGate(`let extracted; ({ ${key}: extracted } = (page as object)!);`);
      await assertRoutingGate(`const { ${key}: extracted = fallback } = page; void extracted;`);
      await assertRoutingGate(`function probe({ ${key}: extracted }) { return extracted; }`);
    }
  }
});

test('路由与 Response 静态键不误报字符串、业务数据、相似名称及无法静态确定的键', async () => {
  const source = `
    // page[\`route\`](payload); const { json: reply } = globalThis.Response;
    const text = 'page["fulfill"]';
    const payload = { route: "business", fulfill: "data", routeFromHAR: "file", routeWebSocket: "text" };
    const { routeName, fulfillOrder, routeFromHARFile, routeWebSocketStatus } = payload;
    page.routeName; page[\`fulfillOrder\`]; page[\`routeFromHARFile\`];
    page[method](payload); page[\`route\${suffix}\`](payload);
    const { [method]: dynamic, [\`route\${suffix}\`]: other } = payload;
    const { json: value } = business.Response;
    const { [\`json\`]: data } = globalThis.MyResponse;
    const { [key]: unknown } = Response;
    const { [\`json\${suffix}\`]: dynamicJson } = Response;
    const dataObject = { json: "data", Response: { json: "label" } };
    const { json } = dataObject;
    await fetch("https://example.invalid/route/fulfill");
  `;
  for (const filePath of [...ordinaryPaths, adapterPath]) {
    const forbidden = (await lint(source, filePath)).filter(message =>
      message.ruleId?.startsWith('quality/') || message.ruleId === 'no-restricted-syntax');
    assert.deepEqual(forbidden, [], filePath);
  }
});

/**
 * 完整生产配置只解析源码，返回网络门禁诊断。
 * @param source - 内存探针。
 * @param filePath - 普通测试或精确例外路径。
 */
async function networkMessages(source, filePath) {
  return (await lint(source, filePath)).filter(message => message.ruleId?.startsWith('quality/')
    || message.ruleId === 'no-restricted-syntax');
}

test('needs-repair 嵌套 Response 解构沿明确全局来源递归，保持精确离线例外', async () => {
  const sources = [];
  for (const root of ['globalThis', 'window', 'self', 'global']) {
    for (const key of ['Response', '["Response"]', '[`Response`]', '[("Response" as const)!]']) {
      for (const field of ['json', '["json"]', '[`json`]', '[("json" satisfies string)]']) {
        sources.push(
          `const { ${key}: { ${field}: reply } } = (${root} as typeof ${root})!; void reply;`,
          `let reply; ({ ${key}: { ${field}: reply } } = ${root});`,
          `function probe({ ${key}: { ${field}: reply } } = ${root}) { return reply; }`,
          `const { globalThis: { ${key}: { ${field}: reply } } } = ${root}; void reply;`,
        );
      }
    }
  }
  for (const source of sources) {
    for (const filePath of ordinaryPaths) {
            const messages = await networkMessages(source, filePath);
            assert.equal(messages.length, 1, `${filePath}: ${source}`);
            assert.equal(messages[0].ruleId, 'quality/no-network-responses');
          }
    assert.deepEqual(await networkMessages(source, adapterPath), [], source);
  }
});

test('真实业务字段的读取、可选链、静态键、嵌套解构及纯数据更新没有网络误报', async () => {
  for (const field of ['route', 'fulfill', 'routeFromHAR', 'routeWebSocket', 'fetch', 'json']) {
    const source = `
      const settings = { ${field}: "business", nested: { ${field}: "data" } };
      const direct = settings.${field};
      const computed = (settings as typeof settings)![\`${field}\`];
      const optional = settings?.["${field}"];
      const { [\`${field}\`]: extracted, nested: { ${field}: deep } } = settings;
      let assigned; ({ ["${field}"]: assigned } = settings);
      const nested = settings.nested?.[\`${field}\`];
      settings.${field} = "updated";
      Object.assign(settings, { [\`${field}\`]: "updated" });
      Object.defineProperty(settings, "${field}", { value: "updated" });
      Object.defineProperties(settings, { ${field}: { value: "updated" } });
      Reflect.defineProperty(settings, "${field}", { value: "updated" });
      Reflect.set(settings, "${field}", "updated");
      console.log(direct, computed, optional, extracted, assigned, deep, nested);
    `;
    for (const filePath of [...ordinaryPaths, adapterPath]) {
      assert.deepEqual(await networkMessages(source, filePath), [], `${filePath}: ${field}`);
    }
  }
});

test('局部同名数据绑定与真正内建来源区分，不按变量名或数据字符串豁免', async () => {
  for (const name of ['globalThis', 'window', 'self', 'global', 'Response', 'Object', 'Reflect']) {
    const source = `
      const ${name} = { Response: { json: "data" }, json: "business", fetch: "label", route: "text" };
      const { Response: { json: value } } = ${name};
      const label = ${name}.Response.json;
      const route = ${name}[\`route\`];
      ${name}.fetch = "updated";
      console.log(value, label, route);
    `;
    for (const filePath of ordinaryPaths) assert.deepEqual(await networkMessages(source, filePath), [], source);
  }
});

test('函数、getter、未知来源和改变后的对象不能冒充纯数据以绕过路由门禁', async () => {
  for (const source of [
    'const settings = { route: async () => undefined }; const alias = settings.route;',
    'const settings = { get route() { throw new Error("must never execute"); } }; settings.route;',
    'const settings = unknown; const { route: alias } = settings;',
    'const { nested: { route: alias } = { route: "data" } } = unknown;',
    'function probe({ route: alias } = { route: "data" }) { return alias; }',
    'const settings = { route: "data" }; (settings as object)!["route"] = handler; settings.route;',
    'let settings = { route: "data" }; settings = page; settings.route;',
    'const settings = { route: "data" }; settings.route = handler; settings.route;',
    'const settings = { route: "data" }; Object.assign(settings, { route: handler }); settings.route;',
    'const settings = { route: "data" }; change(settings); settings.route;',
    'const settings = { nested: { route: handler } }; const { nested: { route: alias } } = settings;',
  ]) {
    for (const filePath of [...ordinaryPaths, adapterPath]) {
      assert.ok((await networkMessages(source, filePath)).some(message =>
        message.ruleId === 'quality/no-network-routing'), `${filePath}: ${source}`);
    }
  }
});

test('纯数据更新豁免不掩盖真正全局 fetch 或带函数的替换', async () => {
  for (const source of [
    'Object.assign(globalThis, { fetch: "data" });',
    'Object.defineProperty(globalThis, "fetch", { value: "data" });',
    'Reflect.set(globalThis, "fetch", "data");',
    'const settings = { fetch: "data" }; Object.assign(settings, { fetch: handler });',
    'const settings = { fetch: "data" }; Object.defineProperty(settings, "fetch", { get: handler });',
    'const settings = { fetch: "data" }; settings.fetch = handler;',
  ]) {
    for (const filePath of ordinaryPaths) {
      assert.ok((await networkMessages(source, filePath)).some(message =>
        message.ruleId === 'quality/no-network-responses'), `${filePath}: ${source}`);
    }
    assert.deepEqual(await networkMessages(source, adapterPath), [], source);
  }
});
