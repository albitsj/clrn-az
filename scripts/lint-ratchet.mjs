import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { historicalFile, initialRevision, previousRevision, sourceSnapshot } from './quality-history.mjs';
import { repository } from './source-files.mjs';

const migratable = new Set(['complexity', 'max-depth', 'no-restricted-syntax', 'C901', 'no-circular']);

/**
 * 将工具原生诊断与确切源码范围绑定，避免用计数或整个文件豁免吞掉新问题。
 * @param tool - 产生诊断的工具。
 * @param file - 诊断所属文件。
 * @param message - 标准化后的规则、位置及说明。
 * @param root - 被独立测量的源码根目录。
 */
export function finding(tool, file, message, root = repository) {
  const source = readFileSync(file, 'utf8').split('\n');
  const excerpt = source.slice(message.line - 1, message.endLine).join('\n');
  return { tool, file: relative(realpathSync(root), realpathSync(file)), ...message,
    sourceHash: createHash('sha256').update(excerpt).digest('hex') };
}

/**
 * 稳定序列化定位信息；迁移原因不参与工具诊断匹配。
 * @param entry - 含工具、规则、位置、消息与源码指纹的迁移项。
 */
export function findingKey(entry) {
  const identity = { ...entry };
  delete identity.reason;
  return JSON.stringify(identity);
}

/**
 * 比较实际诊断与迁移清单；旧项消失时也必须删除清单，保留单调缩减。
 * @param actual - 当前工具诊断。
 * @param accepted - 已登记的历史项。
 */
export function compareFindings(actual, accepted) {
  const current = new Set(actual.map(findingKey));
  const known = new Set(accepted.map(findingKey));
  const added = actual.filter(entry => !known.has(findingKey(entry)));
  const stale = accepted.filter(entry => !current.has(findingKey(entry)));
  return { added, stale };
}

/**
 * 禁止相对变更前提交增加或改写迁移项，连同迁移原因一起审查。
 * @param entries - 当前清单。
 * @param previous - 变更前清单。
 */
export function assertOnlyShrinks(entries, previous) {
  const known = new Set(previous.map(entry => JSON.stringify(entry)));
  if (new Set(entries.map(entry => JSON.stringify(entry))).size !== entries.length) throw new Error('历史违规清单不能包含重复项。');
  if (entries.some(entry => !known.has(JSON.stringify(entry)))) throw new Error('历史违规清单只能缩减，不能新增或改写。');
}

/**
 * 从真实 ESLint 配置收集全部诊断，保留原有文档、类型等检查。
 * @param root - 当前源码或独立历史快照。
 */
export async function eslintFindings(root = repository) {
  const results = await new ESLint({ cwd: root, overrideConfigFile: resolve(repository, 'eslint.config.mjs'), allowInlineConfig: false }).lintFiles(['.']);
  return results.flatMap(result => result.messages.map(message => finding('eslint', result.filePath, {
    rule: message.ruleId, line: message.line, column: message.column,
    endLine: message.endLine ?? message.line, endColumn: message.endColumn ?? message.column,
    message: message.message,
  }, root)));
}

/**
 * 从固定版本 Ruff 收集全部诊断；关闭缓存与行内豁免，检查不修改项目。
 * @param root - 当前源码或独立历史快照。
 */
export function ruffFindings(root = repository) {
  const result = spawnSync('uvx', ['--from', 'ruff==0.15.12', 'ruff', 'check', '.', '--config', resolve(repository, 'ruff.toml'), '--no-cache', '--ignore-noqa', '--output-format', 'json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) throw new Error(result.stderr || 'Ruff 无法完成检查。');
  return JSON.parse(result.stdout).map(message => finding('ruff', message.filename, {
    rule: message.code, line: message.location.row, column: message.location.column,
    endLine: message.end_location.row, endColumn: message.end_location.column, message: message.message,
  }, root));
}

/**
 * 读取 dependency-cruiser 原生 JSON；同一条环从不同入口报告时归一化为确切文件集合。
 * @param root - 当前源码或独立历史快照。
 */
export function dependencyFindings(root = repository) {
  const result = spawnSync(resolve(repository, 'node_modules/.bin/depcruise'),
    ['--config', resolve(repository, '.dependency-cruiser.cjs'), '--output-type', 'json', 'android', 'visual', 'e2e', 'scripts', '*.mjs', '*.cjs'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'dependency-cruiser 无法完成检查。');
  const report = JSON.parse(result.stdout);
  const findings = report.summary.violations.map(violation => {
    const identity = { tool: 'dependency-cruiser', rule: violation.rule.name };
    if (violation.cycle) return { ...identity, cycle: [...new Set(violation.cycle.map(step => step.name))].sort() };
    return { ...identity, from: violation.from, to: violation.to };
  });
  return [...new Map(findings.map(entry => [findingKey(entry), entry])).values()];
}

const collectors = { eslint: eslintFindings, ruff: ruffFindings, 'dependency-cruiser': dependencyFindings };

/**
 * 首次迁移必须属于固定主分支的真实诊断，不能只凭源码片段或文件存在登记。
 * @param entries - 同一工具的待登记迁移项。
 * @param original - 独立历史扫描得到的全部诊断。
 */
export function assertInitialFindings(entries, original) {
  const { added } = compareFindings(entries, original);
  if (added.length) throw new Error(`首次迁移项不在固定主分支的真实诊断中：${JSON.stringify(added)}`);
}

/**
 * 用当前固定规则独立测量历史提交，不能从合并后的源码接受新债务。
 * @param tool - 待测量的工具。
 * @param revision - 已核对的完整历史提交编号。
 */
export async function historicalFindings(tool, revision) {
  const directory = mkdtempSync(join(tmpdir(), 'quality-history-'));
  try {
    const snapshot = sourceSnapshot(revision, directory);
    symlinkSync(resolve(repository, 'node_modules'), join(snapshot, 'node_modules'), 'dir');
    return await collectors[tool](snapshot);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * 首次接入核对固定主分支的实际诊断，之后清单只能缩减。
 * @param entries - 待核对的迁移项。
 * @param baselinePath - 工具对应的迁移清单路径。
 * @param tool - 本次执行的工具。
 */
async function validateHistory(entries, baselinePath, tool) {
  const previous = previousRevision();
  const names = execFileSync('git', ['ls-tree', '--name-only', previous, '--', baselinePath],
    { cwd: repository, encoding: 'utf8' }).trim();
  if (names) return assertOnlyShrinks(entries, JSON.parse(historicalFile(previous, baselinePath)));
  if (previous !== initialRevision) throw new Error('首次门禁必须对照固定的最新主分支，不能使用旧快照。');
  const original = await historicalFindings(tool, initialRevision);
  assertInitialFindings(entries.filter(entry => entry.tool === tool), original);
}

/**
 * 检查指定工具的新增与已修复诊断；报告模式只向标准输出写入原生诊断位置。
 * @param tool - eslint、ruff 或 dependency-cruiser。
 * @param report - 是否仅输出测量数据。
 */
export async function checkLint(tool, report = false) {
  if (!Object.hasOwn(collectors, tool)) throw new Error('用法：node scripts/lint-ratchet.mjs eslint|ruff|dependency-cruiser [--report]');
  const actual = await collectors[tool]();
  if (report) { console.log(JSON.stringify(actual, null, 2)); return; }
  const baselinePath = tool === 'dependency-cruiser' ? 'quality/legacy-cycles.json' : 'quality/legacy-lint.json';
  const entries = JSON.parse(readFileSync(resolve(repository, baselinePath), 'utf8'));
  if (entries.some(entry => !entry.reason?.trim() || !migratable.has(entry.rule))) throw new Error('迁移清单含无原因或不可豁免的规则。');
  await validateHistory(entries, baselinePath, tool);
  const { added, stale } = compareFindings(actual, entries.filter(entry => entry.tool === tool));
  for (const entry of added) console.error(`新增违规：${JSON.stringify(entry)}`);
  for (const entry of stale) console.error(`删除已失效迁移项：${JSON.stringify(entry)}`);
  if (added.length || stale.length) throw new Error(`${tool} 门禁失败：新增 ${added.length}，失效迁移项 ${stale.length}。`);
  console.log(`${tool}：无新增违规；${actual.length} 项精确历史债务见 ${baselinePath}。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkLint(process.argv[2], process.argv.includes('--report'));
}
