import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

/** 加载当前流程源码；仅替换显式列出的设备/阶段边界，不连接设备或网络。
 * @param file - 被测 TypeScript 模块。
 * @param imports - 明确的模块边界替身。
 */
export function loadGameFlow(file, imports) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  const run = compileFunction(compiled.outputText, ['require', 'exports', 'module', 'setTimeout'], { filename: file });
  run(name => fixtureImport(imports, name), module.exports, module, callback => callback());
  return module.exports;
}

/** 未登记的依赖必须失败，防止流程测试静默漏掉新边界。
 * @param imports - 显式模块表。
 * @param name - 当前导入名。
 */
function fixtureImport(imports, name) {
  if (!Object.hasOwn(imports, name)) throw new Error(`未登记流程依赖：${name}`);
  return imports[name];
}

/** 记录阶段选择，同时保留调用上下文供断言。
 * @param calls - 当前测试调用记录。
 * @param name - 阶段名。
 */
export function gameFlowStep(calls, name) {
  return async (...args) => { calls.push([name, ...args]); };
}
