import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { historicalFindings } from './lint-ratchet.mjs';
import { historicalClones } from './lint-duplicates.mjs';
import { repository } from './source-files.mjs';

// 只读测量确切历史提交；输出供审阅，不能更新迁移清单。
const [revision, destination] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(revision || '') || !destination) throw new Error('必须指定完整历史提交编号及报告目录。');
execFileSync('git', ['cat-file', '-e', `${revision}^{commit}`], { cwd: repository });
const output = resolve(destination);
mkdirSync(output, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'quality-measure-'));
try {
  for (const tool of ['eslint', 'ruff', 'dependency-cruiser']) {
    writeFileSync(join(output, `${tool}.json`), JSON.stringify(await historicalFindings(tool, revision), null, 2) + '\n');
  }
  const fingerprints = historicalClones(revision, directory, 'duplicates');
  writeFileSync(join(output, 'fingerprints.json'), JSON.stringify(fingerprints, null, 2) + '\n');
  const report = JSON.parse(readFileSync(join(directory, 'duplicates/jscpd-report.json'), 'utf8'));
  // jscpd 的路径以快照目录为根；归档时仅保存仓库相对路径。
  writeFileSync(join(output, 'duplicates.json'), JSON.stringify(report, null, 2) + '\n');
  const policies = ['eslint.config.mjs', 'ruff.toml', '.dependency-cruiser.cjs', '.jscpd.json', 'package-lock.json'];
  writeFileSync(join(output, 'source.json'), JSON.stringify({
    revision,
    source: `https://github.com/albitsj/clrn-az/commit/${revision}`,
    method: '从该固定提交只读归档源码，使用当前锁定工具与规则独立扫描；不是合并后工作区测量，也不是自动测试通过证明。',
    node: process.version,
    ruff: '0.15.12',
    policyHashes: Object.fromEntries(policies.map(file => [file, createHash('sha256').update(readFileSync(join(repository, file))).digest('hex')])),
  }, null, 2) + '\n');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
