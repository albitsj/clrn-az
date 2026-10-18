import { spawnSync } from 'node:child_process';
const mode = process.env.ANDROID_VISUAL_MODE || 'compare';
if (!['compare', 'reference'].includes(mode)) throw new Error('ANDROID_VISUAL_MODE 必须为 compare 或 reference。');
const requestedFilter = process.env.ANDROID_FILTER || '';
const shardFilter = process.env.ANDROID_SHARD_FILTER || '';
const filter = requestedFilter && shardFilter ? `(?=.*(?:${requestedFilter}))(?=.*(?:${shardFilter}))`
  : requestedFilter || shardFilter;
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test',
  '--config', 'android/playwright.config.ts',
  ...(filter ? ['--grep', filter] : []), ...(mode === 'reference' ? ['--update-snapshots=all'] : [])],
{ stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
