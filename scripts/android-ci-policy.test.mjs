import assert from 'node:assert/strict';
import test from 'node:test';
import { androidAccountMatrix } from './ci-accounts.mjs';
import { planSignature, schedulePlan, shardId, validatePlan, verifyCompletion } from './android-ci-policy.mjs';

/**
 * 使用真实 35 分片矩阵，跨提交轮转账号但保持稳定身份。
 * @param number - 模拟运行编号。
 */
function current(number = 2) {
  const full = androidAccountMatrix(String(number)).include;
  return { full, signature: planSignature(full, 'config-v1'), runId: String(number), runNumber: number,
    workflowId: 10, sha: `sha-${number}`, scope: { repository: 'owner/repo', event: 'pull_request', pr: 46, ref: 'refs/pull/46/merge' } };
}

/**
 * 按历史计划创建真实 job 名及结果；未启动的 remaining 不制造成功记录。
 * @param plan - 历史完整计划。
 * @param failures - 失败分片 ID。
 * @param blocked - 是否因优先失败而未提交剩余任务。
 */
function history(plan, failures = [], blocked = false) {
  const jobs = ['priority', 'remaining'].flatMap(stage => blocked && stage === 'remaining' ? [] : plan[stage].map(id => ({
    id: plan.full.findIndex(item => shardId(item) === id) + 1000, name: `Android ${stage} (${plan.full.find(item => shardId(item) === id).label})`, status: 'completed',
    conclusion: failures.includes(id) ? 'failure' : 'success',
  })));
  return { plan, jobs, run: { id: Number(plan.runId), head_sha: plan.sha, run_number: plan.runNumber,
    workflow_id: plan.workflowId, run_attempt: 1 } };
}

/**
 * 构造阶段门禁结果，空阶段只能被预期地跳过。
 * @param plan - 当前计划。
 */
function dependencies(plan) {
  return Object.fromEntries(['accounts', 'driver', 'apk', 'priority', 'remaining'].map(name => [name,
    { result: ['priority', 'remaining'].includes(name) && !plan[name].length ? 'skipped' : 'success' }]));
}

test('无历史执行全部 35 项，账号轮转不改变测试计划签名', () => {
  const plan = schedulePlan(current(), null);
  assert.equal(plan.priority.length, 0);
  assert.equal(plan.remaining.length, 35);
  assert.equal(current(1).signature, current(2).signature);
  assert.notEqual(current(1).full[0].account, current(2).full[0].account);
});

test('失败优先后自动执行余项，连续修复不缩小当前全量覆盖', () => {
  const first = schedulePlan(current(1));
  const failed = first.remaining.slice(0, 3);
  const second = schedulePlan(current(2), history(first, failed));
  assert.deepEqual(second.priority, failed);
  assert.equal(second.remaining.length, 32);
  const third = schedulePlan(current(3), history(second, [failed[0]], true));
  assert.deepEqual(third.priority, [failed[0]]);
  assert.equal(third.remaining.length, 34); // 上轮通过的另外两项也须在当前提交再次验证。
  const fourth = schedulePlan(current(4), history(third, [failed[0]], true));
  assert.equal(fourth.priority.length, 1);
  assert.equal(fourth.remaining.length, 34);
  const run = history(fourth);
  assert.equal(verifyCompletion(fourth, run.jobs, dependencies(fourth), run.run).length, 35);
  const fifth = schedulePlan(current(5), run);
  assert.equal(fifth.remaining.length, 35);
  assert.equal(fifth.priority.length, 0);
});

test('历史取消、跳过、超时不是成功；结果缺失或重复映射时回退完整检查', () => {
  const first = schedulePlan(current(1));
  for (const conclusion of ['cancelled', 'skipped', 'timed_out', 'neutral', 'action_required']) {
    const previous = history(first);
    previous.jobs[0].conclusion = conclusion;
    assert.deepEqual(schedulePlan(current(), previous).priority, [first.remaining[0]]);
  }
  for (const mutate of [jobs => jobs.pop(), jobs => jobs.push(jobs[0]), jobs => { jobs[0].status = 'in_progress'; }]) {
    const previous = history(first);
    mutate(previous.jobs);
    const next = schedulePlan(current(), previous);
    assert.equal(next.remaining.length, 35);
    assert.equal(next.history, null);
  }
});

test('不同 PR、分支、workflow、历史提交、未来运行和不兼容配置不会混用', () => {
  const first = schedulePlan(current(1));
  for (const mutate of [
    h => { h.plan.scope.pr = 47; }, h => { h.plan.scope.ref = 'refs/heads/other'; },
    h => { h.plan.workflowId = 11; }, h => { h.run.workflow_id = 11; },
    h => { h.run.head_sha = 'different'; }, h => { h.plan.runNumber = 99; },
    h => { h.plan.runId = '99'; }, h => { h.plan.signature = 'changed-config'; },
  ]) {
    const previous = history(structuredClone(first), [first.remaining[0]]);
    mutate(previous);
    const next = schedulePlan(current(), previous);
    assert.equal(next.priority.length, 0);
    assert.equal(next.remaining.length, 35);
  }
});

test('新增、删除、重命名和修改分片过滤器时，完整执行当前配置', () => {
  const first = schedulePlan(current(1));
  for (const change of [
    full => [...full, { ...full[0], shard: 'new', label: 'new check' }],
    full => full.slice(1),
    full => full.map((item, i) => i ? item : { ...item, shard: 'renamed', label: 'renamed' }),
    full => full.map((item, i) => i ? item : { ...item, filter: 'new-filter' }),
  ]) {
    const next = current();
    next.full = change(next.full);
    next.signature = planSignature(next.full, 'config-v1');
    const plan = schedulePlan(next, history(first, [first.remaining[0]]));
    assert.equal(plan.priority.length, 0);
    assert.equal(plan.remaining.length, next.full.length);
  }
});

test('优先通过仍不足以放行；失败、取消、非预期跳过、API 缺项和旧提交都被拒绝', () => {
  const first = schedulePlan(current(1));
  const plan = schedulePlan(current(), history(first, first.remaining.slice(0, 3)));
  const result = history(plan);
  for (const dependency of ['accounts', 'driver', 'apk', 'priority', 'remaining']) {
    for (const conclusion of ['failure', 'cancelled', 'skipped', undefined]) {
      const needs = dependencies(plan);
      needs[dependency].result = conclusion;
      assert.throws(() => verifyCompletion(plan, result.jobs, needs, result.run));
    }
  }
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral']) {
    const jobs = structuredClone(result.jobs);
    jobs[0].conclusion = conclusion;
    assert.throws(() => verifyCompletion(plan, jobs, dependencies(plan), result.run));
  }
  assert.throws(() => verifyCompletion(plan, result.jobs.slice(0, 3), dependencies(plan), result.run));
  assert.throws(() => verifyCompletion(plan, result.jobs, dependencies(plan), { ...result.run, head_sha: 'old-sha' }));
  assert.throws(() => verifyCompletion(plan, [...result.jobs, result.jobs[0]], dependencies(plan), result.run));
  assert.throws(() => validatePlan({ ...plan, remaining: [] }));
  const duplicate = { ...result.jobs[0], name: result.jobs[0].name.replace('priority', 'remaining') };
  assert.throws(() => verifyCompletion(plan, [...result.jobs, duplicate], dependencies(plan), result.run));
});

test('全部历史分片失败时优先阶段就是全量，空的剩余阶段跳过才是合法', () => {
  const first = schedulePlan(current(1));
  const plan = schedulePlan(current(), history(first, first.remaining));
  assert.equal(plan.priority.length, 35);
  assert.equal(plan.remaining.length, 0);
  const result = history(plan);
  assert.equal(verifyCompletion(plan, result.jobs, dependencies(plan), result.run).length, 35);
});
