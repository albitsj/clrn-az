import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialRevision, previousRevision, sourceSnapshot } from './quality-history.mjs';
import { repository } from './source-files.mjs';

/**
 * 对原生 jscpd 指纹取允许次数的交集，已从前一提交移除的重复不能重新引入。
 * @param original - issue 首次实施前的重复指纹及数量。
 * @param previous - 本次变更前的重复指纹及数量。
 */
export function intersectBaselines(original, previous) {
  return { version: 1, fingerprints: Object.fromEntries(Object.entries(original.fingerprints)
    .filter(([hash]) => previous.fingerprints[hash])
    .map(([hash, count]) => [hash, Math.min(count, previous.fingerprints[hash])])) };
}

/**
 * 调用锁定的 jscpd；所有临时基线和 JSON 报告写在临时目录。
 * @param cwd - 待扫描的源码根目录。
 * @param output - 临时报告目录。
 * @param args - 额外的基线参数。
 */
export function runJscpd(cwd, output, args) {
  return execFileSync(join(repository, 'node_modules/.bin/jscpd'),
    ['.', '--config', join(repository, '.jscpd.json'), '--reporters', 'console,json', '--output', output, ...args],
    { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/**
 * 在源码快照上测量旧重复，返回 jscpd 原生指纹清单。
 * @param revision - 只读 Git 提交。
 * @param directory - 临时目录。
 * @param name - 报告名称。
 */
export function historicalClones(revision, directory, name) {
  const snapshot = sourceSnapshot(revision, directory);
  const baseline = join(directory, `${name}.json`);
  runJscpd(snapshot, join(directory, name), ['--baseline', baseline, '--update-baseline']);
  return JSON.parse(readFileSync(baseline, 'utf8'));
}

/**
 * 展示现存重复，基于内容指纹及出现次数阻止新增；不使用全仓重复率抵扣。
 * @param report - 输出完整历史报告供审阅，不执行新增门禁。
 */
export function checkDuplicates(report = false) {
  const directory = mkdtempSync(join(tmpdir(), 'quality-clones-'));
  try {
    const original = historicalClones(initialRevision, directory, 'original');
    const previous = historicalClones(previousRevision(), directory, 'previous');
    const baseline = join(directory, 'allowed.json');
    writeFileSync(baseline, JSON.stringify(intersectBaselines(original, previous)));
    if (report) {
      console.log(readFileSync(join(directory, 'original/jscpd-report.json'), 'utf8'));
      return;
    }
    const output = runJscpd(repository, join(directory, 'current'), ['--baseline', baseline, '--fail-on-new-clones', '0']);
    console.log(output);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) checkDuplicates(process.argv.includes('--report'));
