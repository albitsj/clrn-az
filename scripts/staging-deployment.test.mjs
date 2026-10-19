// 验证自动任务不追随分支候选包，手动显式标签仍可用于合并前回归。
import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentTarget, validateDeployment } from './staging-deployment.mjs';

const record = { environment: 'staging', sha: 'a'.repeat(40),
  deployed_at: '2026-10-15T12:00:00.000Z', release_tag: `android-staging-123-${'a'.repeat(12)}` };

test('部署推送锁定上传标签和完整应用提交，不选择其他最新版本', () => {
  assert.deepEqual(deploymentTarget({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/master' }, () => record),
    { release_tag: record.release_tag, application_commit: record.sha });
  for (const invalid of [null, {}, { ...record, environment: 'production' },
    { ...record, sha: 'b'.repeat(40) }, { ...record, deployed_at: 'bad' },
    { ...record, release_tag: 'injected\noutput=value' }]) {
    assert.throws(() => validateDeployment(invalid));
  }
});

test('PR、定时及未指定标签的手动任务固定部署记录，拒绝无效记录', () => {
  for (const event of ['pull_request', 'schedule', 'workflow_dispatch', 'push']) {
    assert.deepEqual(deploymentTarget({ GITHUB_EVENT_NAME: event }, () => record),
      { release_tag: record.release_tag, application_commit: record.sha });
    assert.throws(() => deploymentTarget({ GITHUB_EVENT_NAME: event }, () => ({})));
  }
  assert.deepEqual(deploymentTarget({ GITHUB_EVENT_NAME: 'pull_request',
    ANDROID_RELEASE_TAG: `android-staging-124-${'b'.repeat(12)}` }, () => record),
  { release_tag: record.release_tag, application_commit: record.sha });
});

test('手动指定分支 Release 不读取默认部署记录，并拒绝无效标签', () => {
  /** 显式选包不应该依赖默认部署记录。 */
  const unexpectedRead = () => { throw new Error('不应读取部署记录'); };
  const candidate = `android-staging-124-${'b'.repeat(12)}`;
  assert.deepEqual(deploymentTarget({ GITHUB_EVENT_NAME: 'workflow_dispatch',
    ANDROID_RELEASE_TAG: candidate }, unexpectedRead),
  { release_tag: candidate, application_commit: '' });
  assert.throws(() => deploymentTarget({ GITHUB_EVENT_NAME: 'workflow_dispatch',
    ANDROID_RELEASE_TAG: 'invalid' }, unexpectedRead), /无效的 Android Release 标签/);
});
