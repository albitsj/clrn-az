import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordDiagnosticAccount } from './password-diagnostic-account.mjs';

const matrix = [{ group: 'account', locale: 'en', account: 'clrnci261015001', label: 'account / en' }];
const environment = { CI_ANDROID_PASSWORD_ACCOUNT: 'clrnci261015045', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/ci-diagnostic/password-native-metrics-bc3048', CI_ANDROID_MODE: 'compare',
  CI_ANDROID_FILTER: 'signed_in_reset_password$' };

test('固定同一账号用于局部对照，保留矩阵身份和原账号互斥键', () => {
  assert.deepEqual(passwordDiagnosticAccount(matrix, environment), [{ ...matrix[0], account: 'clrnci261015045' }]);
  assert.equal(matrix[0].account, 'clrnci261015001');
  assert.equal(passwordDiagnosticAccount(matrix, {}), matrix);
});

for (const changed of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/master' },
  { CI_ANDROID_MODE: 'reference' }, { CI_ANDROID_FILTER: '' }, { CI_ANDROID_PASSWORD_ACCOUNT: 'foreign-account' }]) {
  test(`非授权范围拒绝账号覆盖：${Object.keys(changed)[0]}`, () => {
    assert.throws(() => passwordDiagnosticAccount(matrix, { ...environment, ...changed }));
  });
}

for (const changed of [[], [...matrix, ...matrix], [{ ...matrix[0], group: 'texas' }], [{ ...matrix[0], locale: 'zh-Hans' }]]) {
  test(`非英文账号单分组拒绝覆盖：${JSON.stringify(changed)}`, () => {
    assert.throws(() => passwordDiagnosticAccount(changed, environment));
  });
}
