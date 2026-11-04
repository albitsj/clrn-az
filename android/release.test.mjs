import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packageName, readVerifiedBuild, validateRelease, validateBuildInformation, verifyPackage } from './release.mjs';

const content = Buffer.from('安装包完整性测试');
const information = {
  schemaVersion: 1, platform: 'android', environment: 'staging', applicationId: 'com.ac.laiwanDev',
  applicationCommit: 'f'.repeat(40), buildNumber: 7187, releaseTag: `android-staging-7187-${'f'.repeat(12)}`,
  signing: 'visual-staging-testing-only', architectures: ['x86_64', 'arm64-v8a'],
  package: { name: packageName, size: content.length, sha256: createHash('sha256').update(content).digest('hex') },
};
const release = {
  tag_name: information.releaseTag, draft: false, prerelease: true, published_at: '2026-10-14T09:38:32Z',
  body: '<!-- android-staging schema=1 -->',
  assets: [
    { name: 'build-info.json', state: 'uploaded', size: 603 },
    { name: packageName, state: 'uploaded', size: content.length, digest: `sha256:${information.package.sha256}` },
  ],
};

test('只接受部署记录指定且附件完整的已发布 APK', () => {
  assert.equal(validateRelease(release, information.releaseTag), release);
  for (const candidate of [{ ...release, draft: true }, { ...release, tag_name: 'ios-production' },
    { ...release, body: '' }, { ...release, published_at: null }]) {
    assert.throws(() => validateRelease(candidate, information.releaseTag), /无效/);
  }
  assert.throws(() => validateRelease(release, `android-staging-7185-${'e'.repeat(12)}`), /无效/);
  assert.throws(() => validateRelease({ ...release, assets: [] }, information.releaseTag), /附件/);
  assert.throws(() => validateRelease({ ...release, assets: [...release.assets, release.assets[1]] },
    information.releaseTag), /附件/);
});

test('拒绝生产包、错误应用、提交、版本和不匹配的附件摘要', () => {
  assert.equal(validateBuildInformation(information, release, information.applicationCommit), information);
  assert.throws(() => validateBuildInformation(information, release,
    `${information.applicationCommit.slice(0, 12)}${'a'.repeat(28)}`), /不匹配/);
  for (const change of [
    { environment: 'production' }, { platform: 'ios' }, { applicationId: 'another.app' },
    { applicationCommit: 'a'.repeat(40) }, { buildNumber: 1 }, { releaseTag: 'other' },
    { architectures: ['arm64-v8a'] }, { signing: 'production' },
    { package: { ...information.package, sha256: '0'.repeat(64) } },
  ]) assert.throws(() => validateBuildInformation({ ...information, ...change }, release), /不匹配/);
});

test('实际文件校验能识别截断与等长内容篡改', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clrn-apk-test-'));
  const file = join(directory, packageName);
  try {
    await writeFile(file, content);
    await verifyPackage(file, information);
    await writeFile(file, content.subarray(1));
    await assert.rejects(verifyPackage(file, information), /大小/);
    await writeFile(file, Buffer.alloc(content.length));
    await assert.rejects(verifyPackage(file, information), /SHA-256/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('运行前以部署记录为唯一版本来源，拒绝缓存旧包并接受记录指定的新包', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clrn-deployment-test-'));
  const directory = join(root, 'android/artifacts/current');
  const deploymentFile = join(root, 'deployments/staging.json');
  const deployment = { environment: 'staging', sha: information.applicationCommit,
    deployed_at: '2026-10-20T00:00:00.000Z', release_tag: information.releaseTag };
  try {
    await mkdir(directory, { recursive: true });
    await mkdir(join(root, 'deployments'));
    await writeFile(deploymentFile, JSON.stringify(deployment));
    await writeFile(join(directory, 'build-info.json'), JSON.stringify(information));
    await writeFile(join(directory, 'release.json'), JSON.stringify(release));
    await writeFile(join(directory, packageName), content);
    assert.deepEqual(await readVerifiedBuild(directory), information);

    const next = { ...information, applicationCommit: 'a'.repeat(40), buildNumber: 7188,
      releaseTag: `android-staging-7188-${'a'.repeat(12)}` };
    await writeFile(deploymentFile, JSON.stringify({ ...deployment,
      sha: next.applicationCommit, release_tag: next.releaseTag }));
    await assert.rejects(readVerifiedBuild(directory), /无效/);
    await writeFile(join(directory, 'release.json'), JSON.stringify({ ...release, tag_name: next.releaseTag }));
    await assert.rejects(readVerifiedBuild(directory), /不匹配/);
    await writeFile(join(directory, 'build-info.json'), JSON.stringify(next));
    assert.deepEqual(await readVerifiedBuild(directory), next);
    await writeFile(join(directory, packageName), Buffer.alloc(content.length));
    await assert.rejects(readVerifiedBuild(directory), /SHA-256/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
