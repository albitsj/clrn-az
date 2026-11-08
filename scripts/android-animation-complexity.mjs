import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkScopedComplexity } from './android-game-complexity.mjs';
import { androidAnimationFiles, androidAnimationTools, androidAnimationChecks } from './android-animation-scope.mjs';

/** 使用既有执行器建立动画与截图的独立门禁，不接受历史豁免。
 * @param args - --report 输出每个函数的 classic complexity。
 */
export async function checkAndroidAnimationComplexity(args = []) {
  return checkScopedComplexity([...androidAnimationFiles, ...androidAnimationTools, ...androidAnimationChecks], 'Android 动画与截图', args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkAndroidAnimationComplexity(process.argv.slice(2));
}
