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
