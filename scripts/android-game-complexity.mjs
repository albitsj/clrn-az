import { checkComplexity } from './shared-complexity-runner.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { androidGameFiles, androidGameTools, androidGameChecks } from './android-game-scope.mjs';

/** 通过生产 ESLint 配置建立独立门禁，不接受历史豁免。
 * @param args - --report 输出每个函数的 classic complexity。
 */
export async function checkAndroidGameComplexity(args = []) {
  await checkComplexity([...androidGameFiles, ...androidGameTools, ...androidGameChecks], 'Android 玩法', args.includes('--report'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkAndroidGameComplexity(process.argv.slice(2));
}
