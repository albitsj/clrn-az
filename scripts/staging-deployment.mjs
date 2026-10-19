// 默认固定检出提交中的部署版本，仅手动显式选包时验证其他分支 Release。
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * 校验与 H5 相同的 staging 记录字段，并锁定本次上传的 Android Release。
 * @param record - 应用发布流水线提交的部署记录。
 */
export function validateDeployment(record) {
  const match = /^android-staging-([1-9][0-9]{0,8})-([a-f0-9]{12})$/.exec(record?.release_tag);
  if (record?.environment !== 'staging' || !/^[a-f0-9]{40}$/.test(record.sha)
    || !match || !record.sha.startsWith(match[2])
    || typeof record.deployed_at !== 'string' || !Number.isFinite(Date.parse(record.deployed_at))) {
    throw new Error('Android staging 部署记录无效或 Release 与应用提交不一致。');
  }
  return record;
}

/**
 * 所有任务默认使用本次检出的部署记录，手动执行可显式指定分支 Release。
 * @param env - GitHub Actions 环境及可选手动标签。
 * @param readRecord - 读取当前检出提交中的部署 JSON。
 */
export function deploymentTarget(env, readRecord) {
  const tag = env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? env.ANDROID_RELEASE_TAG : '';
  if (tag) {
    if (!/^android-staging-[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(tag)) {
      throw new Error('无效的 Android Release 标签。');
    }
    return { release_tag: tag, application_commit: '' };
  }
  const record = validateDeployment(readRecord());
  return { release_tag: record.release_tag, application_commit: record.sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('部署规划需要 GITHUB_OUTPUT。');
  const target = deploymentTarget(process.env, () =>
    JSON.parse(readFileSync(new URL('../deployments/staging.json', import.meta.url), 'utf8')));
  appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(target).map(([key, value]) => `${key}=${value}\n`).join(''));
}
