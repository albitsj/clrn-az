import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * 列出已跟踪和未忽略的新文件，排除被删除的文件与依赖、报告等生成目录。
 * @param root - 待扫描的 Git 仓库根目录。
 * @returns 相对于仓库根目录的源码候选路径。
 */
export function sourceFiles(root = repository) {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  return [...new Set(paths)].filter(file => {
    if (/(?:^|\/)(?:node_modules|\.venv|test-results|playwright-report|blob-report|snapshots|\.ttyctl)(?:\/|$)/.test(file)) return false;
    try {
      lstatSync(join(root, file));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    }
  }).sort();
}
