import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { maskScreenshot } = require('./screenshot.ts');
const { samePixels } = require('./motion-regions.ts');
const root = fileURLToPath(new URL('../', import.meta.url));

test('普通截图只比较主基准，备用文件不能补足缺图或放行超标布局', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-screenshot-policy-'));
  try {
    const snapshots = path.join(root, 'android/snapshots/android-35-x86_64-720x1280-en');
    const current = readFileSync(path.join(snapshots, 'en-signed-in-reset-password.png'));
    const wrong = PNG.sync.read(current);
    // 模拟明显的应用布局回归，仍保持原尺寸和稳定画面。
    wrong.data.fill(0, 0, wrong.width * 200 * 4);
    for (let offset = 3; offset < wrong.width * 200 * 4; offset += 4) wrong.data[offset] = 255;
    writeFileSync(path.join(directory, 'current.png'), current);
    writeFileSync(path.join(directory, 'wrong.png'), PNG.sync.write(wrong));
    for (const scenario of ['current', 'wrong']) {
      mkdirSync(path.join(directory, scenario));
      writeFileSync(path.join(directory, scenario, 'page.png'), current);
    }
    writeFileSync(path.join(directory, 'playwright.config.mjs'), `
      import { defineConfig } from ${JSON.stringify(path.join(root, 'node_modules/@playwright/test/index.mjs'))};
      import { screenshotComparison } from ${JSON.stringify(path.join(root, 'android/screenshot-comparison.ts'))};
      export default defineConfig({ testDir: '.', testMatch: 'policy.spec.mjs', workers: 1,
        retries: 0, updateSnapshots: 'none', reporter: 'json', outputDir: './results',
        snapshotPathTemplate: '{testDir}/{testName}/{arg}{ext}',
        expect: { toMatchSnapshot: screenshotComparison } });
    `);
    writeFileSync(path.join(directory, 'policy.spec.mjs'), `
      import { test } from ${JSON.stringify(path.join(root, 'node_modules/@playwright/test/index.mjs'))};
      import { readFileSync } from 'node:fs';
      import { compareScreenshot } from ${JSON.stringify(path.join(root, 'android/device.ts'))};
      for (const scenario of ['current', 'wrong', 'missing']) {
        test(scenario, async ({}, info) => {
          const bytes = readFileSync(new URL(scenario === 'wrong' ? './wrong.png' : './current.png', import.meta.url));
          info.snapshotPath = file => new URL(file === 'page.png' && scenario !== 'missing'
            ? './current.png' : file === 'alternate.png' ? (scenario === 'wrong' ? './wrong.png' : './current.png')
            : './absent.png', import.meta.url).pathname;
          await compareScreenshot({ screenshot: async () => bytes }, 'page', info, [], undefined, undefined,
            ['alternate.png']);
        });
      }
    `);
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'),
      'test', '--config', path.join(directory, 'playwright.config.mjs')],
    { cwd: directory, encoding: 'utf8', timeout: 60_000 });
    assert.ifError(result.error);
    const report = JSON.parse(result.stdout);
    const outcomes = report.suites.flatMap(suite => suite.specs.map(spec =>
      [spec.title, spec.tests[0].results[0].status]));
    const errors = report.suites.flatMap(suite => suite.specs.flatMap(spec =>
      spec.tests.flatMap(item => item.results.map(run => run.error?.message))));
    assert.deepEqual(outcomes, [['current', 'passed'], ['wrong', 'failed'], ['missing', 'failed']],
      JSON.stringify(errors) + result.stderr);
    assert.equal(result.status, 1, '实际比较失败必须保留非零退出码');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('最小遮罩只忽略明确区域，遮罩外布局缺陷、尺寸变化和超面积仍失败', () => {
  const original = new PNG({ width: 100, height: 100 });
  original.data.fill(255);
  const mask = { x: 10, y: 10, width: 10, height: 10, reason: '测试动态值' };
  const expected = maskScreenshot(PNG.sync.write(original), [mask]);
  for (const [x, accepted] of [[10, true], [40, false]]) {
    const changed = PNG.sync.read(PNG.sync.write(original));
    for (let y = 10; y < 20; y++) for (let column = x; column < x + 10; column++) {
      changed.data.fill(0, (y * 100 + column) * 4, (y * 100 + column) * 4 + 3);
    }
    assert.equal(samePixels(maskScreenshot(PNG.sync.write(changed), [mask]), expected), accepted);
  }
  assert.equal(samePixels(maskScreenshot(PNG.sync.write(new PNG({ width: 101, height: 100 })), [mask]), expected), false);
  assert.throws(() => maskScreenshot(PNG.sync.write(original), [{ ...mask, width: 100, height: 100 }]), /12%/);
});
