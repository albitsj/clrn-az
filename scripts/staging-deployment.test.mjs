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

test('手动执行指定标签，PR 和定时任务使用最新版本且不读取部署文件', () => {
  /** 非部署事件不应该读取 master 的记录。 */
  const unexpectedRead = () => { throw new Error('不应读取部署记录'); };
  for (const event of ['pull_request', 'schedule', 'workflow_dispatch']) {
    assert.deepEqual(deploymentTarget({ GITHUB_EVENT_NAME: event }, unexpectedRead),
      { release_tag: '', application_commit: '' });
  }
  assert.equal(deploymentTarget({ GITHUB_EVENT_NAME: 'workflow_dispatch',
    ANDROID_RELEASE_TAG: record.release_tag }, unexpectedRead).release_tag, record.release_tag);
  assert.throws(() => deploymentTarget({ ANDROID_RELEASE_TAG: 'invalid' }, unexpectedRead));
  assert.throws(() => deploymentTarget({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/master' }, unexpectedRead));
});
