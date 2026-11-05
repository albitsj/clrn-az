import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * 在临时仓库执行真实规划器/门禁；gh 只读取离线 API/ZIP 响应，不能访问网络或真实账号。
 * @param context - 自动清理临时文件的测试上下文。
 */
function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'android-ci-cli-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const files = ['scripts/android-ci-run.mjs', 'scripts/android-ci-policy.mjs', 'scripts/android-ci-github.mjs',
    'scripts/ci-accounts.mjs', 'scripts/ci-test-accounts.json', 'android/playwright.config.ts',
    'android/build-driver.mjs', 'android/download-release.mjs', 'android/release-download.mjs', 'android/release.mjs',
    'android/scenarios.ts', 'visual/scenarios.ts', 'android/tests',
    '.github/workflows/android-visual.yml', '.github/actions/android-visual/action.yml',
    'deployments/staging.json', 'package-lock.json'];
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(new URL(`../${file}`, import.meta.url), join(root, file), { recursive: true });
  }
  mkdirSync(join(root, 'bin'));
  const gh = join(root, 'bin/gh');
  writeFileSync(gh, `#!/usr/bin/env node
const fs = require('node:fs');
const routes = JSON.parse(fs.readFileSync(process.env.TEST_API_ROUTES, 'utf8'));
const route = routes[process.argv[3]];
if (!route || route.error) { console.error('signed-url-secret-sentinel'); process.exit(1); }
process.stdout.write(route.archive ? fs.readFileSync(route.archive) : JSON.stringify(route.json));
`);
  chmodSync(gh, 0o755);
  return root;
}

/**
 * 为一次模拟 PR 提交建立真实 GitHub 环境变量及事件。
 * @param root - 临时仓库。
 * @param number - 运行编号。
 */
function environment(root, number) {
  const event = { pull_request: { number: 46, head: { sha: `head-${number}`, ref: 'fix', repo: { full_name: 'owner/repo' } },
    base: { ref: 'master' } } };
  writeFileSync(join(root, 'event.json'), JSON.stringify(event));
  writeFileSync(join(root, 'outputs'), '');
  return { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, GITHUB_RUN_ID: String(number),
    GITHUB_RUN_NUMBER: String(number), GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: `merge-${number}`,
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/46/merge', GITHUB_REF_NAME: '46/merge',
    GITHUB_EVENT_PATH: join(root, 'event.json'), GITHUB_OUTPUT: join(root, 'outputs'),
    GITHUB_STEP_SUMMARY: join(root, 'step-summary'), TEST_API_ROUTES: join(root, 'routes.json'),
    CI_ANDROID_GROUP: 'all', CI_ANDROID_LOCALE: 'all', CI_ANDROID_FILTER: '', CI_ANDROID_MODE: 'compare', CI_ANDROID_FULL: 'false' };
}

/**
 * 真实门禁使用的 jobs 响应包含数字 job ID，以免它覆盖稳定分片 ID。
 * @param plan - 本轮真实规划结果。
 * @param fail - 是否模拟优先分片失败并阻断其余分片。
 */
function runJobs(plan, fail = false) {
  return ['priority', 'remaining'].flatMap(stage => fail && stage === 'remaining' && plan.priority.length ? [] : plan[stage].map((id, index) => {
    const item = plan.full.find(part => `${part.group}/${part.locale}/${part.shard}` === id);
    return { id: 1000 + index, run_attempt: 1, name: `Android ${stage} (${item.label})`, status: 'completed',
      conclusion: fail && index === 0 ? 'failure' : 'success', runner_id: 1,
      started_at: '2026-11-04T00:01:00Z', completed_at: '2026-11-04T00:02:00Z' };
  }));
}

test('真实 CLI 三轮修复：35 → 优先 1 失败且余项未启动 → 优先 1 加剩余 34 全部成功', context => {
  const root = fixture(context);
  const prefix = 'repos/owner/repo/actions';
  let previous;
  for (let number = 1; number <= 3; number++) {
    const env = { ...environment(root, number), CI_ANDROID_FULL: number === 1 ? 'true' : 'false' };
    const run = { id: number, run_number: number, workflow_id: 10, event: 'pull_request', head_branch: 'fix',
      head_sha: `head-${number}`, head_repository: { full_name: 'owner/repo' }, status: 'completed',
      pull_requests: [{ number: 46 }], run_attempt: 1, created_at: '2026-11-04T00:00:00Z' };
    const routes = { [`${prefix}/runs/${number}`]: { json: run },
      [`${prefix}/workflows/10/runs?event=pull_request&branch=fix&per_page=100&page=1`]: { json: { workflow_runs: previous ? [previous.run] : [] } } };
    if (previous) {
      routes[`${prefix}/runs/${previous.run.id}/artifacts?name=android-ci-plan&per_page=100&page=1`] = {
        json: { artifacts: [{ id: previous.run.id, name: 'android-ci-plan', expired: false }] } };
      routes[`${prefix}/artifacts/${previous.run.id}/zip`] = { archive: previous.archive };
      routes[`${prefix}/runs/${previous.run.id}/jobs?filter=all&per_page=100&page=1`] = { json: { jobs: previous.jobs } };
    }
    writeFileSync(join(root, 'routes.json'), JSON.stringify(routes));
    const planned = spawnSync(process.execPath, ['scripts/android-ci-run.mjs', 'plan'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(planned.status, 0, planned.stderr);
    const planPath = join(root, '.ttyctl/android-ci/plan.json');
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    assert.equal(plan.sha, `head-${number}`);
    assert.equal(plan.checkoutSha, `merge-${number}`);
    assert.equal(plan.priority.length, number === 1 ? 0 : 1);
    assert.equal(plan.remaining.length, number === 1 ? 35 : 34);
    const jobs = runJobs(plan, number < 3);
    routes[`${prefix}/runs/${number}/jobs?filter=all&per_page=100&page=1`] = { json: { jobs } };
    writeFileSync(join(root, 'routes.json'), JSON.stringify(routes));
    const needs = phaseResults(number);
    const completed = spawnSync(process.execPath, ['scripts/android-ci-run.mjs', 'complete'], {
      cwd: root, encoding: 'utf8', env: { ...env, CI_ANDROID_NEEDS: JSON.stringify(needs) } });
    assert.equal(completed.status, number === 3 ? 0 : 1, completed.stderr);
    const results = JSON.parse(readFileSync(join(root, '.ttyctl/android-ci/results.json'), 'utf8'));
    assert.equal(results.success, number === 3);
    if (number === 2) assert.equal(jobs.length, 1);
    const archive = join(root, `plan-${number}.zip`);
    execFileSync('zip', ['-j', archive, planPath], { stdio: 'pipe' });
    previous = { run, archive, jobs };
  }
  assert.match(readFileSync(join(root, '.ttyctl/android-ci/summary.md'), 'utf8'), /全部 35 项成功/);
});

test('API 不可用和手动 full=true 均输出完整矩阵，不泄露下载地址；门禁 API 故障不能放行', context => {
  const root = fixture(context);
  const env = environment(root, 1);
  writeFileSync(join(root, 'routes.json'), '{}');
  for (const full of ['true', 'false']) {
    const result = spawnSync(process.execPath, ['scripts/android-ci-run.mjs', 'plan'], {
      cwd: root, encoding: 'utf8', env: { ...env, CI_ANDROID_FULL: full } });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(readFileSync(join(root, '.ttyctl/android-ci/plan.json'), 'utf8'));
    assert.equal(plan.remaining.length, 35);
    assert.equal(plan.priority.length, 0);
    assert.ok(!readFileSync(join(root, '.ttyctl/android-ci/summary.md'), 'utf8').includes('signed-url-secret-sentinel'));
  }
  const failed = spawnSync(process.execPath, ['scripts/android-ci-run.mjs', 'complete'], {
    cwd: root, encoding: 'utf8', env: { ...env, CI_ANDROID_NEEDS: '{}' } });
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(readFileSync(join(root, '.ttyctl/android-ci/results.json'), 'utf8')).success, false);
});

/**
 * 三轮模拟中实际产生的依赖结论。
 * @param number - 模拟运行编号。
 */
function phaseResults(number) {
  const stages = [['skipped', 'failure'], ['failure', 'skipped'], ['success', 'success']][number - 1];
  return { accounts: { result: 'success' }, driver: { result: 'success' }, apk: { result: 'success' },
    priority: { result: stages[0] }, remaining: { result: stages[1] } };
}


test('手动局部及 reference 运行使用诊断门禁，不能覆盖完整比较的 required checks', context => {
  const root = fixture(context);
  const env = { ...environment(root, 1), GITHUB_EVENT_NAME: 'workflow_dispatch', CI_ANDROID_FULL: 'true' };
  writeFileSync(join(root, 'routes.json'), '{}');
  for (const [selection, expected] of [
    [{}, 'true'], [{ CI_ANDROID_GROUP: 'guest' }, 'false'],
    [{ CI_ANDROID_LOCALE: 'en' }, 'false'], [{ CI_ANDROID_FILTER: 'auth' }, 'false'],
    [{ CI_ANDROID_MODE: 'reference' }, 'false'],
  ]) {
    writeFileSync(join(root, 'outputs'), '');
    const planned = spawnSync(process.execPath, ['scripts/android-ci-run.mjs', 'plan'], {
      cwd: root, encoding: 'utf8', env: { ...env, ...selection } });
    assert.equal(planned.status, 0, planned.stderr);
    assert.ok(readFileSync(join(root, 'outputs'), 'utf8').includes(`merge-gate=${expected}\n`));
  }
});
