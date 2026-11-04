import { createHash } from 'node:crypto';

/** 预期分片尚未同步；仅此错误允许当前门禁重新读取 Jobs API。 */
export class PendingJobsError extends Error {}

/**
 * 稳定分片标识不包含随运行轮转的账号。
 * @param shard - 当前账号矩阵的一项。
 */
export function shardId(shard) {
  return `${shard.group}/${shard.locale}/${shard.shard}`;
}

/**
 * 对当前测试计划和执行配置取摘要；配置变化必须回退全量。
 * @param full - 当前完整矩阵。
 * @param configuration - 当前执行配置的文件内容与输入。
 */
export function planSignature(full, configuration) {
  const stable = full.map(item => { const copy = { ...item }; delete copy.account; return copy; });
  return createHash('sha256').update(JSON.stringify({ stable, configuration })).digest('hex');
}

/**
 * 校验计划必须恰好覆盖当前矩阵一次。
 * @param plan - 已持久化的完整计划与两个阶段。
 */
export function validatePlan(plan) {
  if (plan?.version !== 1) throw new Error('计划版本无效');
  if (!['full', 'priority', 'remaining'].every(key => Array.isArray(plan[key])) || !plan.full.length) throw new Error('计划格式无效');
  const full = plan.full.map(shardId);
  const selected = [...plan.priority, ...plan.remaining];
  if (new Set(full).size !== full.length || new Set(plan.full.map(item => item.label)).size !== full.length
    || selected.length !== full.length || new Set(selected).size !== full.length
    || selected.some(id => !full.includes(id))) throw new Error('计划未完整覆盖所有分片');
}

/**
 * 获取某阶段预期的唯一 job；缺失、重复、未完成都不能可靠映射。
 * @param plan - 当前或历史完整计划。
 * @param jobs - GitHub 本次最新 attempt 的 job 列表。
 * @param stage - priority 或 remaining。
 */
export function stageJobs(plan, jobs, stage) {
  return plan[stage].map(id => {
    const shard = plan.full.find(item => shardId(item) === id);
    const name = `Android ${stage} (${shard.label})`;
    const matches = jobs.filter(job => job.name === name);
    if (matches.length > 1) {
      throw new Error(`无法可靠映射 ${name}`);
    }
    if (!matches.length || matches[0].status !== 'completed' || !matches[0].conclusion) {
      throw new PendingJobsError(`无法可靠映射 ${name}`);
    }
    return { ...matches[0], shardId: id };
  });
}

/**
 * 当前与历史身份必须完全对应；任何无法证明的映射回退全量。
 * @param current - 当前完整计划。
 * @param history - API 运行及历史计划。
 */
function validateHistory(current, history) {
  const previous = history.plan;
  const pairs = [[previous.signature, current.signature], [previous.scope, current.scope],
    [previous.workflowId, current.workflowId], [String(previous.runId), String(history.run.id)],
    [previous.sha, history.run.head_sha], [history.run.workflow_id, current.workflowId],
    [previous.runNumber, history.run.run_number],
    [previous.full.map(shardId), current.full.map(shardId)]];
  if (!pairs.every(([a, b]) => JSON.stringify(a) === JSON.stringify(b)) || previous.runNumber >= current.runNumber) {
    throw new Error('历史身份、分片或执行配置不兼容');
  }
}

/**
 * 历史仅决定顺序；未放行的剩余项始终从当前完整矩阵保留。
 * @param current - 包含身份、配置摘要和完整矩阵的当前计划。
 * @param history - 同范围历史运行的计划和 job；不存在时执行全量。
 */
export function schedulePlan(current, history) {
  const plan = { ...current, version: 1, priority: [], remaining: current.full.map(shardId),
    reason: '无有效历史，完整执行当前计划', history: null };
  validatePlan(plan);
  if (!history) return plan;
  try {
    const previous = history.plan;
    validatePlan(previous);
    validateHistory(current, history);
    const priority = stageJobs(previous, history.jobs, 'priority');
    const failedPriority = priority.filter(job => job.conclusion !== 'success');
    // 上轮优先失败时，remaining 从未提交。不能把它们丢掉或当作成功。
    const checked = failedPriority.length ? priority : [...priority, ...stageJobs(previous, history.jobs, 'remaining')];
    const failed = checked.filter(job => job.conclusion !== 'success').map(job => job.shardId);
    plan.priority = failed;
    plan.remaining = current.full.map(shardId).filter(id => !failed.includes(id));
    plan.history = { runId: history.run.id, attempt: history.run.run_attempt, sha: history.run.head_sha };
    plan.reason = failed.length ? '先验证历史未成功的分片，再执行其余检查' : '历史全部成功，完整执行当前计划';
  } catch (error) {
    plan.reason = `历史不可用，完整执行当前计划：${error.message}`;
  }
  validatePlan(plan);
  return plan;
}

/**
 * 先拒绝快照中已明确的失败与映射错误，不能让另一缺项将它们变成可重试错误。
 * @param plan - 已验证的本轮完整计划。
 * @param jobs - 本轮最新 job 快照。
 */
function validateJobSnapshot(plan, jobs) {
  const expected = new Set(['priority', 'remaining'].flatMap(stage => plan[stage].map(id =>
    `Android ${stage} (${plan.full.find(item => shardId(item) === id).label})`)));
  const selected = jobs.filter(job => expected.has(job.name));
  const heavy = jobs.filter(job => /^Android (priority|remaining) \(/.test(job.name) && job.conclusion !== 'skipped');
  if (new Set(selected.map(job => job.name)).size !== selected.length || heavy.some(job => !expected.has(job.name))) {
    throw new Error('当前提交存在重复或计划外分片');
  }
  if (selected.some(job => job.conclusion && job.conclusion !== 'success')) throw new Error('当前提交仍有未成功分片');
  return heavy;
}

/**
 * 全量门禁同时检查阶段结论、完整计划和当前提交每个实际 job。
 * @param plan - 本轮计划。
 * @param jobs - 本轮最新 job 列表，不能使用旧提交结果。
 * @param needs - GitHub needs 依赖结论。
 * @param run - 当前运行身份。
 */
export function verifyCompletion(plan, jobs, needs, run) {
  validatePlan(plan);
  const identity = [[String(plan.runId), String(run.id)], [plan.sha, run.head_sha], [plan.workflowId, run.workflow_id]];
  if (identity.some(([a, b]) => a !== b)) {
    throw new Error('门禁计划不属于当前提交或 workflow');
  }
  for (const dependency of ['accounts', 'driver', 'apk', 'priority', 'remaining']) {
    const expected = ['priority', 'remaining'].includes(dependency) && !plan[dependency].length ? 'skipped' : 'success';
    if (needs[dependency]?.result !== expected) throw new Error(`${dependency} 阶段未满足 ${expected}`);
  }
  const heavy = validateJobSnapshot(plan, jobs);
  const executed = [...stageJobs(plan, jobs, 'priority'), ...stageJobs(plan, jobs, 'remaining')];
  if (heavy.length !== plan.full.length) throw new Error('当前提交执行数量与完整计划不一致');
  return executed;
}
