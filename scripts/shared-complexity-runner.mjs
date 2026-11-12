import { ESLint } from 'eslint';
import { relative } from 'node:path';

/** Run one explicitly scoped gate through the production ESLint configuration.
 * @param files - Exact files or responsibility globs.
 * @param label - Gate name for diagnostics.
 * @param report - Whether to print per-function classic measurements.
 */
export async function checkComplexity(files, label, report) {
  const overrideConfig = report ? { rules: { complexity: ['error', { max: 0, variant: 'classic' }] } } : undefined;
  const eslint = new ESLint({ allowInlineConfig: false, overrideConfig });
  const results = await eslint.lintFiles(files);
  if (report) {
    console.log(JSON.stringify(results.flatMap(functionMeasurements), null, 2));
    return;
  }
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) console.error(output);
  if (results.some(result => result.errorCount > 0)) throw new Error(`${label}复杂度门禁失败。`);
  console.log(`${label}复杂度门禁通过：测试及辅助实现 ≤3，独立工具/根配置 ≤6。`);
}

/** 从 ESLint 原生诊断取得逐函数数据；解析失败必须阻断测量。
 * @param result - 单文件 ESLint 结果。
 */
function functionMeasurements(result) {
  if (result.fatalErrorCount) throw new Error(`无法解析 ${result.filePath}`);
  return result.messages.filter(message => message.ruleId === 'complexity').map(message => ({
    file: relative(process.cwd(), result.filePath), line: message.line, column: message.column,
    function: message.message.split(' has a complexity')[0],
    complexity: Number(message.message.match(/complexity of (\d+)/)[1]),
  }));
}
