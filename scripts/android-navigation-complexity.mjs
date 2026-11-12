import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkComplexity } from './shared-complexity-runner.mjs';
import { androidNavigationFiles, androidNavigationTools, androidNavigationChecks } from './android-navigation-scope.mjs';

/** 独立约束 issue #49 范围，使用生产配置并拒绝行内及历史豁免。
 * @param args - --report 输出逐函数 classic complexity。
 */
export async function checkAndroidNavigationComplexity(args = []) {
  return checkComplexity([...androidNavigationFiles, ...androidNavigationTools, ...androidNavigationChecks], 'Android 设备与导航', args.includes('--report'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkAndroidNavigationComplexity(process.argv.slice(2));
}
