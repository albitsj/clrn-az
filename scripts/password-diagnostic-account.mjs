import { executionAccounts } from './ci-accounts.mjs';

/** 独立探针允许同一账号下成对对照，正式回归和其他业务范围一律拒绝覆盖。
 * @param matrix - 当前已验证的完整矩阵。
 * @param environment - 调度输入及 GitHub 身份。
 */
export function passwordDiagnosticAccount(matrix, environment) {
  const selected = environment.CI_ANDROID_PASSWORD_ACCOUNT;
  if (!selected) return matrix;
  const authorized = [environment.GITHUB_EVENT_NAME === 'workflow_dispatch',
    environment.GITHUB_REF === 'refs/heads/ci-diagnostic/password-native-metrics-bc3048',
    environment.CI_ANDROID_MODE === 'compare', matrix.length === 1,
    matrix[0]?.group === 'account', matrix[0]?.locale === 'en',
    environment.CI_ANDROID_FILTER?.includes('reset_password'), executionAccounts.includes(selected)];
  if (!authorized.every(Boolean)) throw new Error('固定诊断账号只允许独立探针分支的英文密码页局部比较');
  return matrix.map(item => ({ ...item, account: selected }));
}
