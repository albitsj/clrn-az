import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { androidAccountMatrix } from './ci-accounts.mjs';
import { passwordDiagnosticAccount } from './password-diagnostic-account.mjs';
import { PendingJobsError, planSignature, schedulePlan, shardId, verifyCompletion } from './android-ci-policy.mjs';
import { githubJson, githubJobs, loadHistory } from './android-ci-github.mjs';

const directory = '.ttyctl/android-ci';
const repository = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
const runEndpoint = `repos/${repository}/actions/runs/${runId}`;

/**
 * 摘要写入 GitHub UI，同时保存在调度诊断产物中。
 * @param content - 不含凭据的 Markdown。
 */
function summary(content) {
  writeFileSync(`${directory}/summary.md`, content);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, content);
}

/**
 * 展示完整来源与分片列表，不用旧成功替代当前验证。
 * @param plan - 当前完整执行计划。
 */
function planSummary(plan) {
  const source = plan.history ? `run ${plan.history.runId}, attempt ${plan.history.attempt}, SHA ${plan.history.sha}` : '无';
  return `## Android 两阶段调度\n\n历史来源：${source}\n\n${plan.reason}\n\n当前 SHA：${plan.sha}\n\n`
    + `优先检查 (${plan.priority.length})：${plan.priority.join(', ') || '无'}\n\n`
    + `剩余检查 (${plan.remaining.length})：${plan.remaining.join(', ') || '无'}\n\n`
    + '手动全量：workflow_dispatch 选择 full=true，group=all、locale=all、filter 留空、mode=compare。\n\n';
}

/** 当前矩阵与配置都来自检出提交，账号只分配一次。 */
function currentPlan() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const full = passwordDiagnosticAccount(androidAccountMatrix(runId,
    process.env.CI_ANDROID_GROUP || 'all', process.env.CI_ANDROID_LOCALE || 'all').include, process.env);
  const files = ['.github/workflows/android-visual.yml', '.github/actions/android-visual/action.yml',
    'scripts/android-ci-policy.mjs', 'scripts/android-ci-github.mjs', 'scripts/android-ci-run.mjs',
    'scripts/ci-accounts.mjs', 'scripts/password-diagnostic-account.mjs', 'scripts/ci-test-accounts.json', 'android/playwright.config.ts',
    'android/build-driver.mjs', 'android/download-release.mjs', 'android/release-download.mjs', 'android/release.mjs',
    'android/scenarios.ts', 'visual/scenarios.ts',
    'deployments/staging.json', 'package-lock.json'];
  files.push(...readdirSync('android/tests').filter(file => file.endsWith('.spec.ts')).sort().map(file => `android/tests/${file}`));
  const configuration = files.map(file => [file, readFileSync(file, 'utf8')]);
  configuration.push(['filter', process.env.CI_ANDROID_FILTER || ''], ['mode', process.env.CI_ANDROID_MODE || 'compare']);
  return { full, runId, runNumber: Number(process.env.GITHUB_RUN_NUMBER), workflowId: null,
    sha: event.pull_request?.head.sha || process.env.GITHUB_SHA, checkoutSha: process.env.GITHUB_SHA, signature: planSignature(full, configuration),
    scope: currentScope(event) };
}

/**
 * 用稳定 PR/分支身份隔离历史，不将不同来源仓库或 base 分支混用。
 * @param event - GitHub 原始事件。
 */
function currentScope(event) {
  const pr = event.pull_request;
  return { repository, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
    pr: pr?.number || null, headRepository: pr?.head.repo.full_name || repository,
    headBranch: pr?.head.ref || process.env.GITHUB_REF_NAME, baseBranch: pr?.base.ref || null };
}

/** 读取历史失败；任何读取或兼容性问题都回退当前配置全量。 */
function planRun() {
  const current = currentPlan();
  let history;
  let fallback;
  try {
    const run = githubJson(runEndpoint);
    current.workflowId = run.workflow_id;
    if (process.env.CI_ANDROID_FULL !== 'true') history = loadHistory(current, run);
  } catch {
    // gh 错误可能包含临时下载地址；不把原始 stderr 写入公开摘要。
    fallback = '历史 API 或计划产物不可用，完整执行当前计划';
  }
  if (process.env.CI_ANDROID_FULL === 'true') fallback = '手动强制全量执行';
  const plan = schedulePlan(current, history);
  if (fallback) plan.reason = fallback;
  writeFileSync(`${directory}/plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
  const outputs = { matrix: { include: plan.full }, 'merge-gate': String(isMergeGate()) };
  for (const stage of ['priority', 'remaining']) {
    outputs[stage] = { include: plan.full.filter(item => plan[stage].includes(shardId(item))) };
    outputs[`has-${stage}`] = String(plan[stage].length > 0);
  }
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  }
  summary(planSummary(plan));
}

/** 手动局部或 reference 诊断不能把已有 required checks 标记为成功。 */
function isMergeGate() {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') return true;
  return (process.env.CI_ANDROID_GROUP || 'all') === 'all' && (process.env.CI_ANDROID_LOCALE || 'all') === 'all'
    && !process.env.CI_ANDROID_FILTER && (process.env.CI_ANDROID_MODE || 'compare') === 'compare';
}

/**
 * 记录启动数量与反馈时间；run 创建到 job 开始包含依赖等待，并非纯 runner 排队时间。
 * @param plan - 当前完整计划。
 * @param jobs - 本轮最新 job 列表。
 * @param run - 当前 GitHub run。
 */
function phaseSummary(plan, jobs, run) {
  let result = '| 阶段 | 计划数 | 已启动数 | 成功数 | 最早开始（run 创建后秒） |\n| --- | ---: | ---: | ---: | ---: |\n';
  for (const stage of ['priority', 'remaining']) {
    const names = plan[stage].map(id => `Android ${stage} (${plan.full.find(item => shardId(item) === id).label})`);
    const selected = jobs.filter(job => names.includes(job.name));
    const started = selected.filter(job => job.runner_id && job.started_at);
    const first = started.length ? Math.min(...started.map(job => Date.parse(job.started_at))) : null;
    result += `| ${stage} | ${names.length} | ${started.length} | ${selected.filter(job => job.conclusion === 'success').length} | ${first === null ? '—' : Math.round((first - Date.parse(run.created_at)) / 1000)} |\n`;
  }
  const failures = jobs.filter(job => /^Android (priority|remaining) \(/.test(job.name)
    && ['failure', 'timed_out', 'cancelled'].includes(job.conclusion) && job.completed_at);
  const feedback = failures.length ? Math.round((Math.min(...failures.map(job => Date.parse(job.completed_at))) - Date.parse(run.created_at)) / 1000) : null;
  return `${result}\n失败反馈：${feedback === null ? '无失败反馈' : `${feedback} 秒（run 创建至首个失败分片完成）`}。\n\n`
    + '开始时间含准备及阶段依赖等待；GitHub jobs API 未提供独立入队时间，不将此数值当作纯排队时间。\n\n';
}

/**
 * 分页及网络等待共用截止时间，给门禁写入诊断和上传产物留出时间。
 * @param endpoint - 本轮 Jobs API 分页地址。
 * @param deadline - 单调时钟上的同步截止时间。
 */
function completionJson(endpoint, deadline) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new Error('等待 Jobs API 状态同步超时');
  return githubJson(endpoint, Math.ceil(Math.min(30000, remaining)));
}

/**
 * 仅等待尚未同步的预期分片，每轮都重新分页查询；身份、依赖与失败仍严格验证。
 * @param plan - 本轮完整计划。
 * @param needs - 当前依赖结论。
 * @param run - 当前运行身份。
 * @param snapshot - 保存最后一次完整 API 快照，超时或错误后仍可输出诊断。
 */
async function waitForCompletion(plan, needs, run, snapshot) {
  const deadline = performance.now() + 5 * 60 * 1000;
  while (true) {
    snapshot.jobs = githubJobs(runEndpoint, endpoint => completionJson(endpoint, deadline));
    try {
      return verifyCompletion(plan, snapshot.jobs, needs, run);
    } catch (error) {
      if (!(error instanceof PendingJobsError)) throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error(`等待 Jobs API 状态同步超时：${error.message}`, { cause: error });
      console.log(`Jobs API 状态尚未同步：${error.message}；等待后重新查询。`);
      await setTimeout(Math.min(10000, remaining));
    }
  }
}

/** 无条件运行的总门禁，任何缺失、取消、失败、意外跳过均不能放行。 */
async function completeRun() {
  const plan = JSON.parse(readFileSync(`${directory}/plan.json`, 'utf8'));
  const needs = JSON.parse(process.env.CI_ANDROID_NEEDS);
  let report = planSummary(plan);
  const snapshot = { jobs: [] };
  let run;
  let failure;
  try {
    run = githubJson(runEndpoint);
    // 强制全量或规划时 API 故障仍可按唯一 run ID + SHA 校验本轮身份。
    const verifiedPlan = plan.workflowId === null ? { ...plan, workflowId: run.workflow_id } : plan;
    if (plan.checkoutSha !== process.env.GITHUB_SHA) throw new Error('检出提交不一致');
    const executed = await waitForCompletion(verifiedPlan, needs, run, snapshot);
    const last = Math.max(...executed.map(job => Date.parse(job.completed_at)));
    report += `当前提交全部 ${plan.full.length} 项成功。全部重型分片完成耗时：${Math.round((last - Date.parse(run.created_at)) / 1000)} 秒（不含最终汇总和兼容门禁）。\n\n`;
  } catch (error) {
    failure = error;
    report += `全量门禁失败：${error.message}。详见本轮依赖结论及 job 诊断。\n\n`;
  }
  report += `阶段结论：${Object.entries(needs).map(([name, value]) => `${name}=${value.result}`).join(', ')}\n\n`;
  if (run) report += phaseSummary(plan, snapshot.jobs, run);
  summary(report);
  writeFileSync(`${directory}/results.json`, `${JSON.stringify({ runId, sha: plan.sha, success: !failure, needs, jobs: snapshot.jobs }, null, 2)}\n`);
  if (failure) throw new Error('当前提交的 Android 完整回归未通过');
}

mkdirSync(directory, { recursive: true });
if (process.argv[2] === 'plan') planRun();
else if (process.argv[2] === 'complete') await completeRun();
else throw new Error('指定 plan 或 complete');
