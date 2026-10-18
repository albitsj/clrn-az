import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import baseline from '../animation-assets.json';
import { comparePackagedAnimations } from '../animation-assets';
import { artifacts } from '../device';

test('published Android APK contains every reviewed animation asset', async () => {
  test.skip(!['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all')
    || (process.env.ANDROID_LOCALE || 'en') !== 'en', '素材与应用语言无关，只在英文游客任务校验一次');
  const build = JSON.parse(readFileSync(path.join(artifacts, 'build-info.json'), 'utf8'));
  expect(build.applicationCommit, '新应用版本需要重新核对动画素材清单').toBe(baseline.applicationCommit);
  comparePackagedAnimations(path.join(artifacts, 'android-staging.apk'),
    baseline.assets as unknown as Record<string, [string, number]>);
});
