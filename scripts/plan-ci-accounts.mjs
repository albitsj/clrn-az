import { appendFileSync } from 'node:fs';
import { androidAccountMatrix } from './ci-accounts.mjs';

if (!process.env.GITHUB_OUTPUT) throw new Error('账号调度脚本只能由 GitHub Actions 执行。');
if (process.argv[2] !== 'android') throw new Error('账号调度模式必须为 android。');
const matrix = androidAccountMatrix(process.env.GITHUB_RUN_ID,
  process.env.CI_ANDROID_GROUP || 'all', process.env.CI_ANDROID_LOCALE || 'all');
appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
