import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readDeploymentRecord } from '../scripts/staging-deployment.mjs';

export const releaseRepository = 'kevinanew/clrn';
export const applicationId = 'com.ac.laiwanDev';
export const packageName = 'android-staging.apk';
const releasePattern = /^android-staging-(\d+)-([a-f0-9]{12})$/;

/**
 * 只接受部署记录指定且已发布的 Android Staging Release。
 * @param selected - GitHub 返回的 Release。
 * @param tag - 当前部署记录中的标签。
 */
export function validateRelease(selected, tag) {
  if (selected?.draft || !selected?.published_at || !releasePattern.test(selected.tag_name)
    || selected.tag_name !== tag || !selected.body?.includes('<!-- android-staging schema=1 -->')) {
    throw new Error('部署记录指定的 Android Staging Release 无效或尚未发布。');
  }
  for (const name of ['build-info.json', packageName]) {
    const assets = selected.assets.filter(asset => asset.name === name && asset.state === 'uploaded');
    if (assets.length !== 1 || assets[0].size <= 0) throw new Error(`Release 附件缺失或无效：${name}`);
  }
  return selected;
}

/**
 * 核对构建平台、环境、版本和附件身份，拒绝错误包及不一致的元数据。
 * @param information - Release 中的构建元数据。
 * @param release - 已选定的 GitHub Release。
 * @param expectedCommit - 部署记录中的完整应用提交。
 */
export function validateBuildInformation(information, release, expectedCommit) {
  const match = releasePattern.exec(release.tag_name);
  const asset = release.assets.find(item => item.name === packageName);
  if (!match || information.schemaVersion !== 1 || information.platform !== 'android'
    || information.environment !== 'staging' || information.applicationId !== applicationId
    || information.releaseTag !== release.tag_name || !/^[a-f0-9]{40}$/.test(information.applicationCommit)
    || information.applicationCommit !== expectedCommit
    || !information.applicationCommit.startsWith(match[2]) || information.buildNumber !== Number(match[1])
    || information.signing !== 'visual-staging-testing-only'
    || !['x86_64', 'arm64-v8a'].every(value => information.architectures?.includes(value))
    || information.package?.name !== packageName || information.package.size !== asset?.size
    || !/^[a-f0-9]{64}$/.test(information.package.sha256)
    || (asset.digest && asset.digest !== `sha256:${information.package.sha256}`)) {
    throw new Error('Release 构建信息不匹配，拒绝安装。');
  }
  return information;
}

/**
 * 流式核对安装包大小与 SHA-256，避免下载中断或错误附件进入测试。
 * @param file - 本地安装包路径。
 * @param information - 经过身份校验的构建信息。
 */
export async function verifyPackage(file, information) {
  if ((await stat(file)).size !== information.package.size) throw new Error('APK 大小校验失败。');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== information.package.sha256) throw new Error('APK SHA-256 校验失败。');
}

/**
 * 每次运行前重新校验本地附件，防止复用下载目录时混入其他版本。
 * @param directory - 下载目录。
 */
export async function readVerifiedBuild(directory) {
  const deployment = readDeploymentRecord(resolve(directory, '../../../deployments/staging.json'));
  const information = JSON.parse(await readFile(`${directory}/build-info.json`, 'utf8'));
  const release = JSON.parse(await readFile(`${directory}/release.json`, 'utf8'));
  validateBuildInformation(information, validateRelease(release, deployment.release_tag), deployment.sha);
  await verifyPackage(`${directory}/${packageName}`, information);
  return information;
}
