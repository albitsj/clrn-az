import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { repository } from './source-files.mjs';

/** 使用真实配置与脚本创建隔离探针项目，绝不写入共享工作树。
 * @param context - 管理目录清理的测试上下文。
 * @param config - 门禁名称与最小文件集合。
 */
export function temporaryComplexityProject(context, config) {
  const directory = mkdtempSync(join(tmpdir(), `${config.name}-complexity-`));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of ['package.json', 'eslint.config.mjs', 'scripts']) {
    cpSync(join(repository, file), join(directory, file), { recursive: true });
  }
  symlinkSync(join(repository, 'node_modules'), join(directory, 'node_modules'), 'dir');
  for (const file of config.fixturePaths) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'export const probe = 1;');
  }
  return directory;
}
