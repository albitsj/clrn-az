import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { androidAccountMatrix } from './ci-accounts.mjs';
import { schedulePlan, shardId } from './android-ci-policy.mjs';

/**
 * 在隔离目录执行真实 complete CLI；仅替换 gh 和等待时钟，不改写门禁逻辑。
 * @param context - 自动清理目录的测试上下文。
 * @param priorityCount - 优先阶段分片数；覆盖空阶段与两阶段。
 */
function completionFixture(context, priorityCount = 1) {
  const root = mkdtempSync(join(tmpdir(), 'android-ci-completion-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'bin', '.ttyctl/android-ci']) mkdirSync(join(root, directory), { recursive: true });
  for (const file of ['android-ci-run.mjs', 'android-ci-policy.mjs', 'android-ci-github.mjs', 'ci-accounts.mjs', 'ci-test-accounts.json']) {
    cpSync(new URL(file, import.meta.url), join(root, 'scripts', file));
  }
  const run = { id: 2, head_sha: 'current-head', workflow_id: 10, created_at: '2026-11-04T00:00:00Z' };
  const plan = schedulePlan({ full: androidAccountMatrix('2').include, runId: '2', runNumber: 2,
    workflowId: 10, sha: run.head_sha, checkoutSha: 'current-merge' });
  plan.priority = plan.remaining.splice(0, priorityCount);
  const needs = Object.fromEntries(['accounts', 'driver', 'apk', 'priority', 'remaining'].map(stage => [stage,
    { result: ['priority', 'remaining'].includes(stage) && !plan[stage].length ? 'skipped' : 'success' }]));
  const jobs = ['priority', 'remaining'].flatMap(stage => plan[stage].map(id => ({
    id: 1000 + plan.full.findIndex(item => shardId(item) === id), run_attempt: 1,
    name: `Android ${stage} (${plan.full.find(item => shardId(item) === id).label})`,
    status: 'completed', conclusion: 'success', runner_id: 1,
    started_at: '2026-11-04T00:01:00Z', completed_at: '2026-11-04T00:02:00Z',
  })));
  const gh = join(root, 'bin/gh');
  writeFileSync(gh, `#!/usr/bin/env node
const fs = require('node:fs');
const { run, snapshots } = JSON.parse(fs.readFileSync('routes.json', 'utf8'));
const endpoint = process.argv[3];
if (endpoint === 'repos/owner/repo/actions/runs/2') {
  process.stdout.write(JSON.stringify(run));
} else if (endpoint === 'repos/owner/repo/actions/runs/2/jobs?filter=all&per_page=100&page=1') {
  const count = Number(fs.readFileSync('queries', 'utf8'));
  fs.writeFileSync('queries', String(count + 1));
  const snapshot = snapshots[Math.min(count, snapshots.length - 1)];
  if (snapshot.error) { console.error('signed-url-secret-sentinel'); process.exit(1); }
  process.stdout.write(JSON.stringify(snapshot));
} else { process.exit(1); }
`);
  chmodSync(gh, 0o755);
  writeFileSync(join(root, 'clock.mjs'), `import timers from 'node:timers/promises';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
let elapsed = 0;
performance.now = () => elapsed;
timers.setTimeout = async milliseconds => {
  elapsed += milliseconds;
  writeFileSync('elapsed', String(elapsed));
};
syncBuiltinESMExports();
`);
  return { root, run, plan, needs, jobs };
}

/**
 * 返回真实进程退出状态、最终诊断产物与摘要，验证最终行为而非仅检查 API 调用。
 * @param fixture - 当前运行的隔离计划和环境。
 * @param snapshots - 每次重新查询返回的新 API 快照；末项持续返回。
 */
function complete(fixture, snapshots) {
  const { root, run, plan, needs } = fixture;
  writeFileSync(join(root, '.ttyctl/android-ci/plan.json'), JSON.stringify(plan));
  writeFileSync(join(root, 'routes.json'), JSON.stringify({ run, snapshots }));
  writeFileSync(join(root, 'queries'), '0');
  writeFileSync(join(root, 'elapsed'), '0');
  const result = spawnSync(process.execPath, ['--import', './clock.mjs', 'scripts/android-ci-run.mjs', 'complete'], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '2', GITHUB_SHA: 'current-merge', CI_ANDROID_NEEDS: JSON.stringify(needs),
      GITHUB_STEP_SUMMARY: join(root, 'step-summary') },
  });
  assert.ifError(result.error);
  return { ...result, results: JSON.parse(readFileSync(join(root, '.ttyctl/android-ci/results.json'), 'utf8')),
    summary: readFileSync(join(root, '.ttyctl/android-ci/summary.md'), 'utf8'),
    stepSummary: readFileSync(join(root, 'step-summary'), 'utf8'),
    queries: Number(readFileSync(join(root, 'queries'), 'utf8')), elapsed: Number(readFileSync(join(root, 'elapsed'), 'utf8')) };
}

for (const priorityCount of [0, 1, 35]) {
  test(`真实 CLI 等待缺项和 in_progress 同步后自动通过全部 35 项（priority=${priorityCount}）`, context => {
    const fixture = completionFixture(context, priorityCount);
    const incomplete = structuredClone(fixture.jobs.slice(0, -1));
    incomplete[0] = { ...incomplete[0], status: 'in_progress', conclusion: null, completed_at: null };
    const result = complete(fixture, [{ jobs: incomplete }, { jobs: fixture.jobs.slice(1) }, { jobs: fixture.jobs }]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.results.success, true);
    assert.deepEqual(result.results.jobs, fixture.jobs);
    assert.equal(result.results.jobs.length, 35);
    assert.match(result.summary, /当前提交全部 35 项成功/);
    assert.equal(result.stepSummary, result.summary);
    assert.equal(result.queries, 3);
    assert.equal(result.elapsed, 20000);
  });
}

for (const incomplete of ['missing', 'in_progress', 'conclusion']) {
  test(`真实 CLI 持续 ${incomplete} 到截止时间仍拒绝放行并保留最后诊断`, context => {
    const fixture = completionFixture(context);
    const jobs = structuredClone(fixture.jobs);
    if (incomplete === 'missing') jobs.pop();
    else jobs[0] = { ...jobs[0], status: incomplete === 'in_progress' ? 'in_progress' : 'completed', conclusion: null };
    const result = complete(fixture, [{ jobs }]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.results.success, false);
    assert.deepEqual(result.results.jobs, jobs);
    assert.match(result.summary, /等待.*Jobs API.*超时/);
    assert.doesNotMatch(result.summary, /当前提交全部 35 项成功/);
    assert.equal(result.stepSummary, result.summary);
    assert.ok(result.queries > 1);
    assert.equal(result.elapsed, 300000);
  });
}

test('真实 CLI 遇到终态失败、重复映射、错误身份或依赖失败立即拒绝，后续成功快照不能覆盖', context => {
  const changes = [
    ...['failure', 'cancelled', 'skipped', 'timed_out', 'neutral'].map(conclusion => fixture => { fixture.jobs.at(-1).conclusion = conclusion; }),
    fixture => { fixture.jobs.push({ ...fixture.jobs.at(-1), id: 9999 }); },
    fixture => { fixture.jobs.at(-1).name = 'Android remaining (unexpected)'; },
    fixture => { fixture.run.head_sha = 'old-head'; },
    fixture => { fixture.run.workflow_id = 99; },
    fixture => { fixture.run.id = 99; },
    fixture => { fixture.plan.checkoutSha = 'old-merge'; },
    fixture => { fixture.needs.remaining.result = 'cancelled'; },
  ];
  for (const change of changes) {
    const fixture = completionFixture(context);
    const success = structuredClone(fixture.jobs);
    change(fixture);
    fixture.jobs[0] = { ...fixture.jobs[0], status: 'in_progress', conclusion: null };
    const result = complete(fixture, [{ jobs: fixture.jobs }, { jobs: success }]);
    assert.equal(result.status, 1, result.summary);
    assert.equal(result.results.success, false);
    assert.equal(result.queries, fixture.plan.checkoutSha === 'current-merge' ? 1 : 0);
    assert.equal(result.elapsed, 0);
    assert.doesNotMatch(result.summary, /等待.*超时/);
  }
});

test('真实 CLI 等待过程中转为失败或 API 故障仍拒绝放行，不泄露原始错误', context => {
  for (const apiFailure of [false, true]) {
    const fixture = completionFixture(context);
    const pending = fixture.jobs.slice(0, -1);
    const failed = structuredClone(fixture.jobs);
    failed[0].conclusion = 'failure';
    const result = complete(fixture, [{ jobs: pending }, apiFailure ? { error: true } : { jobs: failed }, { jobs: fixture.jobs }]);
    assert.equal(result.status, 1, result.summary);
    assert.equal(result.results.success, false);
    assert.deepEqual(result.results.jobs, apiFailure ? pending : failed);
    assert.equal(result.queries, 2);
    assert.equal(result.elapsed, 10000);
    assert.doesNotMatch(result.summary + result.stderr + result.stdout, /signed-url-secret-sentinel/);
  }
});
