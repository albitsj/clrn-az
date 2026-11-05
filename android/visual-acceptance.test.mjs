/** 通过真实测试进程的报告和退出码验证设备验收不能把 flaky 当成成功。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));

test('Android 验收在首轮失败而重试通过时仍以非零退出，报告保留两轮原始结果', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'clrn-visual-acceptance-'));
  try {
    fs.writeFileSync(join(directory, 'playwright.config.mjs'), `
      import { createRequire } from 'node:module';
      const { default: configuration } = createRequire(import.meta.url)(${JSON.stringify(join(repository, 'android/playwright.config.ts'))});
      export default { ...configuration, testDir: '.', testMatch: 'acceptance.spec.mjs',
        testIgnore: [], reporter: 'json', outputDir: './results' };
    `);
    fs.writeFileSync(join(directory, 'acceptance.spec.mjs'), `
      import { test } from ${JSON.stringify(join(repository, 'node_modules/@playwright/test/index.mjs'))};
      test('first attempt passed', async () => {});
      test('passed only after retry', async ({}, info) => {
        if (info.retry === 0) throw new Error('first attempt animation failure');
      });
    `);
    const command = [join(repository, 'node_modules/@playwright/test/cli.js'),
      'test', '--config', join(directory, 'playwright.config.mjs')];
    const options = { cwd: directory, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, CI: 'true', ANDROID_LOCALE: 'en' } };
    const result = spawnSync(process.execPath, command, options);
    assert.ifError(result.error);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.errors, [], '退出码不能来自全局配置或 worker 错误');
    assert.deepEqual([report.stats.expected, report.stats.flaky, report.stats.unexpected], [1, 1, 0], result.stderr);
    const flaky = report.suites[0].specs.find(spec => spec.title === 'passed only after retry');
    assert.deepEqual(flaky.tests[0].results.map(run => [run.retry, run.status]), [[0, 'failed'], [1, 'passed']]);
    assert.match(flaky.tests[0].results[0].error.message, /first attempt animation failure/);
    assert.equal(result.status, 1, '最终成功且没有 unexpected 的 flaky 报告也必须阻塞验收');
    const clean = spawnSync(process.execPath, [...command, '--grep', 'first attempt passed'], options);
    assert.ifError(clean.error);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    const passed = JSON.parse(clean.stdout);
    assert.deepEqual([passed.stats.expected, passed.stats.flaky, passed.stats.unexpected], [1, 0, 0]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
