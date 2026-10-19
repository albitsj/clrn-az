import assert from 'node:assert/strict';
import test from 'node:test';
import { readDeploymentRecord, validateDeployment } from './staging-deployment.mjs';

const record = { environment: 'staging', sha: 'a'.repeat(40),
  deployed_at: '2026-10-15T12:00:00.000Z', release_tag: `android-staging-123-${'a'.repeat(12)}` };

test('只接受与完整应用提交一致的 staging 部署记录', () => {
  assert.deepEqual(validateDeployment(record), record);
  for (const invalid of [null, {}, { ...record, environment: 'production' },
    { ...record, sha: 'b'.repeat(40) }, { ...record, deployed_at: 'bad' },
    { ...record, release_tag: 'injected\noutput=value' }]) {
    assert.throws(() => validateDeployment(invalid));
  }
});

test('检出提交直接读取固定部署记录', () => {
  const current = readDeploymentRecord(new URL('../deployments/staging.json', import.meta.url));
  assert.equal(current.environment, 'staging');
  assert.ok(current.sha.startsWith(current.release_tag.split('-').at(-1)));
});
