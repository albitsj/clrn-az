import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { repository } from './source-files.mjs';

// 首次接入以宿主登记并合入的最新 master 为准，不使用旧修复分支的测量快照。
export const initialRevision = '24e46865d9f36075915d81360c495381564d7e95';

/** 返回本地 HEAD 或 CI 提供的变更前提交，拒绝缺失历史时退化为只报告。 */
export function previousRevision() {
  const revision = process.env.QUALITY_BASE_REV || 'HEAD';
  if (revision !== 'HEAD' && !/^[a-f0-9]{40}$/.test(revision)) throw new Error('QUALITY_BASE_REV 必须是完整提交 SHA。');
  execFileSync('git', ['cat-file', '-e', `${revision}^{commit}`], { cwd: repository });
  // 宿主保留首次接入 master 的合并状态时，HEAD 仍是旧修复分支；首次测量对照登记 master。
  // 仅识别这一固定 MERGE_HEAD；合并完成后及未来其他合并仍对照 HEAD 清单，不能扩容。
  if (!process.env.QUALITY_BASE_REV) {
    const mergePath = execFileSync('git', ['rev-parse', '--git-path', 'MERGE_HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
    const mergeFile = resolve(repository, mergePath);
    if (existsSync(mergeFile) && readFileSync(mergeFile, 'utf8').trim() === initialRevision) return initialRevision;
  }
  return revision;
}

/**
 * 读取指定提交中的文件，不改索引、分支或历史。
 * @param revision - 已验证的提交。
 * @param file - 仓库内文件。
 */
export function historicalFile(revision, file) {
  return execFileSync('git', ['show', `${revision}:${file}`], { cwd: repository, encoding: 'utf8' });
}

/**
 * 将指定提交的源码展开到临时目录供工具扫描；不创建 Git 工作树。
 * @param revision - 固定提交或变更前提交。
 * @param parent - 临时归档的父目录。
 */
export function sourceSnapshot(revision, parent = tmpdir()) {
  const directory = mkdtempSync(join(parent, 'quality-source-'));
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', revision],
    { cwd: repository, encoding: 'utf8' }).trim().split('\n')
    .filter(file => /\.(?:[cm]?[jt]sx?|py)$/.test(file) || file === '.gitignore');
  if (files.length === 0) throw new Error(`未发现 ${revision} 的源码，拒绝空跑。`);
  const archive = join(directory, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, revision, '--', ...files], { cwd: repository });
  execFileSync('tar', ['-xf', archive, '-C', directory]);
  return directory;
}
