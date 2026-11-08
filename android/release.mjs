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
  if (!publishedRelease(selected)) throw new Error('部署记录指定的 Android Staging Release 无效或尚未发布。');
  if (!releaseIdentity(selected, tag)) throw new Error('部署记录指定的 Android Staging Release 无效或尚未发布。');
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
  const invalid = 'Release 构建信息不匹配，拒绝安装。';
  if (!match) throw new Error(invalid);
  if (!buildIdentity(information, release)) throw new Error(invalid);
  if (!commitIdentity(information, match, expectedCommit)) throw new Error(invalid);
  if (!['x86_64', 'arm64-v8a'].every(value => information.architectures?.includes(value))) throw new Error(invalid);
  if (!packageIdentity(information.package, asset)) throw new Error(invalid);
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

/** 先验证发布状态，避免空 Release 被当成有效元数据。
 * @param selected - GitHub Release。
 */
function publishedRelease(selected) {
  return !selected?.draft && Boolean(selected?.published_at);
}

/** 标签和 schema 必须属于部署记录。
 * @param selected - 已发布的 Release。
 * @param tag - 部署标签。
 */
function releaseIdentity(selected, tag) {
  return releasePattern.test(selected.tag_name) && selected.tag_name === tag
    && Boolean(selected.body?.includes('<!-- android-staging schema=1 -->'));
}

/** 对固定平台、签名及环境逐字段校验。
 * @param information - 构建信息。
 * @param release - 当前 Release。
 */
function buildIdentity(information, release) {
  const expected = { schemaVersion: 1, platform: 'android', environment: 'staging', applicationId,
    releaseTag: release.tag_name, signing: 'visual-staging-testing-only' };
  return Object.entries(expected).every(([key, value]) => information[key] === value);
}

/** 完整提交须同时匹配部署和标签前缀，构建号须匹配标签。
 * @param information - 构建信息。
 * @param match - 已解析的发布标签。
 * @param expectedCommit - 部署提交。
 */
function commitIdentity(information, match, expectedCommit) {
  if (!/^[a-f0-9]{40}$/.test(information.applicationCommit) || information.applicationCommit !== expectedCommit) return false;
  return information.applicationCommit.startsWith(match[2]) && information.buildNumber === Number(match[1]);
}

/** 附件大小、名称及可选 GitHub 摘要均须匹配。
 * @param candidate - 构建中的 APK 信息。
 * @param asset - GitHub 附件。
 */
function packageIdentity(candidate, asset) {
  if (candidate?.name !== packageName || candidate.size !== asset?.size) return false;
  if (!/^[a-f0-9]{64}$/.test(candidate.sha256)) return false;
  return digestIdentity(candidate.sha256, asset);
}

/** GitHub 提供摘要时必须逐字匹配。
 * @param sha256 - 已验证格式的 APK 摘要。
 * @param asset - GitHub 附件。
 */
function digestIdentity(sha256, asset) { return !asset.digest || asset.digest === `sha256:${sha256}`; }
