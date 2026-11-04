import path from 'node:path';
import { test } from '@playwright/test';
import baseline from '../animation-assets.json';
import { comparePackagedAnimations } from '../animation-assets';
import { artifacts } from '../device';
// @ts-expect-error 元数据验证模块也供纯 Node 下载入口使用。
import { readVerifiedBuild } from '../release.mjs';

test('published Android APK contains every reviewed animation asset', async () => {
  test.skip(!['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all')
    || (process.env.ANDROID_LOCALE || 'en') !== 'en', '素材与应用语言无关，只在英文游客任务校验一次');
  await readVerifiedBuild(artifacts);
  comparePackagedAnimations(path.join(artifacts, 'android-staging.apk'),
    baseline.assets as unknown as Record<string, [string, number]>);
});
