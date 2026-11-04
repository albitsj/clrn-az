import { ESLint } from 'eslint';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { androidGameFiles, androidGameTools, androidGameChecks } from './android-game-scope.mjs';

/** 通过生产 ESLint 配置建立独立门禁，不接受历史豁免。
 * @param args - --report 输出每个函数的 classic complexity。
 */
export async function checkAndroidGameComplexity(args = []) {
  const report = args.includes('--report');
  const overrideConfig = report ? { rules: { complexity: ['error', { max: 0, variant: 'classic' }] } } : undefined;
  const eslint = new ESLint({ allowInlineConfig: false, overrideConfig });
  const results = await eslint.lintFiles([...androidGameFiles, ...androidGameTools, ...androidGameChecks]);
  if (report) {
    console.log(JSON.stringify(results.flatMap(functionMeasurements), null, 2));
    return;
  }
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) console.error(output);
  if (results.some(result => result.errorCount > 0)) throw new Error('Android 玩法复杂度门禁失败。');
  console.log('Android 玩法复杂度门禁通过：测试及辅助实现 ≤3，独立工具/根配置 ≤6。');
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkAndroidGameComplexity(process.argv.slice(2));
}
