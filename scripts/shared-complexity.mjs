import { sourceFiles } from './source-files.mjs';
import { checkComplexity } from './shared-complexity-runner.mjs';
import { matchesGlob, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sharedSupport, sharedTools, sharedChecks } from './shared-scope.mjs';

/** 通过生产 ESLint 配置建立独立门禁，不接受历史豁免。
 * @param args - --report 输出每个函数的 classic complexity。
 */
export async function checkSharedComplexity(args = []) {
  await checkComplexity(scopedFiles(), '共享视觉、E2E 与工具', args.includes('--report'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkSharedComplexity(process.argv.slice(2));
}

/** Include new adjacent modules and tests without requiring nonexistent glob matches. */
function scopedFiles() {
  const patterns = [...sharedSupport, ...sharedTools, ...sharedChecks];
  const files = sourceFiles().filter(file => patterns.some(pattern => matchesGlob(file, pattern)));
  if (!files.length) throw new Error('共享复杂度门禁范围为空。');
  return files;
}
