import { readFileSync } from 'node:fs';

/**
 * 校验应用流水线提交的部署记录。
 * @param record - 当前检出提交中的部署 JSON。
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

/** 当前检出提交的部署记录是唯一的 APK 版本来源。 */
export function readDeploymentRecord() {
  return validateDeployment(JSON.parse(readFileSync(new URL('../deployments/staging.json', import.meta.url), 'utf8')));
}
