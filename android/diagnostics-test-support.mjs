import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
export const { preserveAnimationFailure } = require('./animation-diagnostics.ts');

/** 将测试目标编译为可注入依赖的 CommonJS 源码。
 * @param filename - 相对于此目录的 TypeScript 文件名。
 * @returns 编译后的源码。
 */
export function diagnosticSource(filename) {
  return ts.transpileModule(readFileSync(new URL(filename, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
}
