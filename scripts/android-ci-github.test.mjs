import assert from 'node:assert/strict';
import test from 'node:test';
import { githubPages, githubJobs, loadHistory } from './android-ci-github.mjs';

const run = { id: 50, run_number: 5, workflow_id: 10, event: 'pull_request', head_branch: 'fix',
  head_repository: { full_name: 'owner/repo' }, status: 'completed', pull_requests: [{ number: 46 }] };
const current = { scope: { repository: 'owner/repo', pr: 46 } };

/**
 * 静态 API 适配器只返回指定数据；未登记请求必须失败。
 * @param runs - API 返回的候选运行。
 */
function historyApi(runs) {
  return {
    /**
     * 读取已登记的离线 API。
     * @param endpoint - API 路径。
     */
    request(endpoint) {
    if (endpoint.includes('/runs?')) return { workflow_runs: runs };
    if (endpoint.includes('/jobs?')) return { jobs: [] };
    throw new Error(`unexpected endpoint ${endpoint}`);
  },
  /**
   * 读取已选历史的离线计划。
   * @param _repository - 仓库名。
   * @param selected - 历史运行。
   */
  readPlan(_repository, selected) { return { runId: selected.id }; } };
}

test('历史查找按 workflow、事件、分支、PR、来源仓库隔离，只选择最近较早运行', () => {
  const previous = { ...run, id: 40, run_number: 4 };
  const foreign = [
    { ...previous, workflow_id: 11 }, { ...previous, event: 'push' },
    { ...previous, head_branch: 'other' }, { ...previous, pull_requests: [{ number: 47 }] },
    { ...previous, head_repository: { full_name: 'fork/repo' } },
  ];
  const selected = loadHistory(current, run, historyApi([...foreign, previous, run, { ...previous, id: 30, run_number: 3 }]));
  assert.equal(selected.run.id, 40);
  assert.deepEqual(selected.plan, { runId: 40 });
  assert.equal(loadHistory(current, run, historyApi([run, ...foreign])), null);
});

test('上一轮未完成、API 失败或产物缺失时抛出供上层回退，不使用更旧结果', () => {
  const previous = { ...run, id: 40, run_number: 4, status: 'in_progress' };
  assert.throws(() => loadHistory(current, run, historyApi([previous, { ...run, id: 30, run_number: 3 }])), /未结束/);
  assert.throws(() => loadHistory(current, run, { request: failApi }));
  const api = historyApi([{ ...previous, status: 'completed' }]);
  api.readPlan = expiredPlan;
  assert.throws(() => loadHistory(current, run, api), /expired/);
});

test('分页读取超过一页的 job，拒绝错误结构和未完整读取', () => {
  const pages = [];
  const result = githubPages('jobs?filter=all', 'jobs', endpoint => {
    pages.push(endpoint);
    return { jobs: endpoint.endsWith('page=1') ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }] };
  });
  assert.equal(result.length, 101);
  assert.equal(pages.length, 2);
  assert.throws(() => githubPages('jobs?', 'jobs', () => ({})));
  assert.throws(() => githubPages('jobs?', 'jobs', () => ({ jobs: Array(100).fill({}) })), /分页/);
});

test('原生 failed-jobs 重跑沿用同 run 成功项，更新失败项；同 attempt 重名不可隐藏', () => {
  const jobs = [
    { id: 1, name: 'a', run_attempt: 1, conclusion: 'success' },
    { id: 2, name: 'b', run_attempt: 1, conclusion: 'failure' },
    { id: 3, name: 'b', run_attempt: 2, conclusion: 'success' },
  ];
  assert.deepEqual(githubJobs('run', () => ({ jobs })).map(job => job.id), [1, 3]);
  const duplicate = { ...jobs[2], id: 4 };
  assert.deepEqual(githubJobs('run', () => ({ jobs: [...jobs, duplicate] })).map(job => job.id), [1, 3, 4]);
});

/** 模拟 API 不可用。 */
function failApi() { throw new Error('API unavailable'); }

/** 模拟计划产物过期。 */
function expiredPlan() { throw new Error('artifact expired'); }
