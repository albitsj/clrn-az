import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 使用 gh 的认证读取 JSON；任何网络错误交给规划器回退全量。
 * @param endpoint - 仓库内 Actions API 路径。
 */
export function githubJson(endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', timeout: 30000,
      maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    throw new Error('GitHub Actions API 不可用或响应无效');
  }
}

/**
 * 分页读取 jobs、artifacts 或 runs，不静默丢弃后续页。
 * @param endpoint - 含查询参数的 API 路径。
 * @param key - 返回数组属性。
 * @param request - 可替换的只读 API 接口。
 */
export function githubPages(endpoint, key, request = githubJson) {
  const items = [];
  for (let page = 1; page <= 20; page++) {
    const batch = request(`${endpoint}&per_page=100&page=${page}`)[key];
    if (!Array.isArray(batch)) throw new Error('Actions API 格式无效');
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error('Actions API 超出安全分页范围');
}

/**
 * 只读取已选历史运行的计划文件；不解压执行任何历史代码。
 * @param repository - owner/name。
 * @param run - 已验证范围的历史 workflow run。
 * @param request - 可替换的 JSON 接口。
 */
export function readHistoryPlan(repository, run, request = githubJson) {
  const artifacts = githubPages(`repos/${repository}/actions/runs/${run.id}/artifacts?name=android-ci-plan`, 'artifacts', request);
  const matches = artifacts.filter(item => item.name === 'android-ci-plan' && !item.expired);
  if (matches.length !== 1) throw new Error('历史完整计划产物缺失或过期');
  const directory = mkdtempSync(join(tmpdir(), 'android-ci-history-'));
  try {
    const archive = join(directory, 'plan.zip');
    writeFileSync(archive, execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${matches[0].id}/zip`],
      { timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    return JSON.parse(execFileSync('unzip', ['-p', archive, 'plan.json'],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * 选当前 PR/分支同 workflow 最近的一轮；不能绕过较新的不完整历史去选旧成功结果。
 * @param current - 当前计划及精确作用域。
 * @param run - 当前 GitHub run。
 * @param api - 可替换的 API/产物读取器，便于离线故障验证。
 */
export function loadHistory(current, run, api = { request: githubJson, readPlan: readHistoryPlan }) {
  const prefix = `repos/${current.scope.repository}/actions`;
  const query = `event=${encodeURIComponent(run.event)}&branch=${encodeURIComponent(run.head_branch)}`;
  const runs = githubPages(`${prefix}/workflows/${run.workflow_id}/runs?${query}`, 'workflow_runs', api.request);
  const candidates = runs.filter(item => sameRunScope(item, run) && item.run_number < run.run_number)
    .filter(item => !current.scope.pr || !item.pull_requests?.length || item.pull_requests.some(pr => pr.number === current.scope.pr))
    .sort((a, b) => b.run_number - a.run_number);
  const previous = candidates[0];
  if (!previous) return null;
  if (previous.status !== 'completed') throw new Error('上一轮仍未结束');
  return { run: previous, plan: api.readPlan(current.scope.repository, previous, api.request),
    jobs: githubJobs(`${prefix}/runs/${previous.id}`, api.request) };
}

/**
 * 同一提交的原生 failed-jobs 重跑会保留此前成功项；按 job 名选最新 attempt。
 * 同一 attempt 内重复名字仍保留，让门禁拒绝不明确映射。
 * @param endpoint - 当前或历史 run 的 API 路径。
 * @param request - 可替换的 JSON 接口。
 */
export function githubJobs(endpoint, request = githubJson) {
  const jobs = githubPages(`${endpoint}/jobs?filter=all`, 'jobs', request);
  const latest = new Map();
  for (const job of jobs) latest.set(job.name, Math.max(latest.get(job.name) || 0, job.run_attempt));
  return jobs.filter(job => job.run_attempt === latest.get(job.name));
}

/**
 * GitHub 元数据先按事件、分支及来源仓库隔离，产物中的 scope 再验证 PR。
 * @param item - 候选历史运行。
 * @param run - 当前运行。
 */
function sameRunScope(item, run) {
  return item.workflow_id === run.workflow_id && item.event === run.event && item.head_branch === run.head_branch
    && item.head_repository?.full_name === run.head_repository?.full_name;
}
