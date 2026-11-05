/** 在真实 Playwright reference 模式运行生产准备与完整采集，基准只写入临时目录。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshots = path.join(root, 'android/snapshots/android-35-x86_64-720x1280-en');

test('首次 reference 为四种玩家动作生成完整候选，旧图不阻止采集，缺失动画仍失败', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-player-action-reference-'));
  try {
    writeFileSync(path.join(directory, 'playwright.config.mjs'), `
      import { defineConfig } from ${JSON.stringify(path.join(root, 'node_modules/@playwright/test/index.mjs'))};
      export default defineConfig({ testDir: '.', testMatch: 'reference.spec.mjs', workers: 1,
        retries: 0, updateSnapshots: 'all', reporter: 'json', outputDir: './results',
        snapshotPathTemplate: '{testDir}/snapshots/{testName}/{arg}{ext}' });
    `);
    writeFileSync(path.join(directory, 'reference.spec.mjs'), `
      import { test, expect } from ${JSON.stringify(path.join(root, 'node_modules/@playwright/test/index.mjs'))};
      import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
      import path from 'node:path';
      import { PNG } from ${JSON.stringify(path.join(root, 'node_modules/pngjs/lib/png.js'))};
      import { waitForPlayerActionStart, playerActionRegion } from ${JSON.stringify(path.join(root, 'android/texas-support.ts'))};
      import { captureNativeTransition } from ${JSON.stringify(path.join(root, 'android/animation-transition.ts'))};
      for (const scenario of ['call', 'raise', 'check', 'fold', 'changed', 'jump', 'static', 'unfinished']) {
        test(scenario, async ({}, info) => {
          const action = ['call', 'raise', 'check', 'fold'].includes(scenario) ? scenario : 'raise';
          const name = 'texas-player-action-' + action;
          const start = readFileSync(path.join(${JSON.stringify(snapshots)}, name + '-start.png'));
          const middle = readFileSync(action === 'check'
            ? ${JSON.stringify(path.join(root, 'android/fixtures/player-action/check-middle.png'))}
            : path.join(${JSON.stringify(snapshots)}, name + '-middle.png'));
          const end = readFileSync(path.join(${JSON.stringify(snapshots)}, name + '-end.png'));
          if (scenario === 'changed') {
            mkdirSync(path.dirname(info.snapshotPath(name + '-start.png')), { recursive: true });
            writeFileSync(info.snapshotPath(name + '-start.png'), readFileSync(${JSON.stringify(path.join(root, 'android/fixtures/player-action/raise-start-with-call.png'))}));
          } else expect(existsSync(info.snapshotPath(name + '-start.png'))).toBe(false);
          const screen = crop => {
            const canvas = new PNG({ width: 720, height: 1280 });
            const part = PNG.sync.read(crop);
            PNG.bitblt(part, canvas, 0, 0, part.width, part.height, playerActionRegion.x, playerActionRegion.y);
            return PNG.sync.write(canvas).toString('base64');
          };
          let triggered = false;
          const device = { _connection: { toImpl: () => ({ _send: async method => {
            if (method === 'tree') return { bounds: playerActionRegion, children: [
              { res: 'texas-holdem-player-container-target-operating', bounds: playerActionRegion, children: [] }] };
            expect(method).toBe('screen');
            return screen(triggered && scenario !== 'static' ? end : start);
          } }) } };
          await waitForPlayerActionStart(device, info, action, 'target');
          const timeline = scenario === 'jump' ? [start, start, end]
            : scenario === 'static' ? [start, start, start]
            : scenario === 'unfinished' ? [start, middle, start] : [start, middle, end];
          await captureNativeTransition(device, name, info, playerActionRegion, () => { triggered = true; },
            [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [],
            async (_name, _region, trigger) => { await trigger(); return timeline; });
        });
      }
    `);
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'),
      'test', '--config', path.join(directory, 'playwright.config.mjs')],
    { cwd: directory, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, ANDROID_LOCALE: 'en' } });
    assert.ifError(result.error);
    const report = JSON.parse(result.stdout);
    const specs = report.suites.flatMap(suite => suite.specs);
    assert.deepEqual(specs.map(spec => [spec.title, spec.tests[0].results[0].status]),
      ['call', 'raise', 'check', 'fold', 'changed', 'jump', 'static', 'unfinished']
        .map((name, index) => [name, index < 5 ? 'passed' : 'failed']),
      JSON.stringify(specs.map(spec => ({ name: spec.title, errors: spec.tests[0].results[0].errors }))) + result.stderr);
    assert.equal(result.status, 1, '缺失真实中途或终点的采集必须保留失败退出码');
    for (const scenario of ['call', 'raise', 'check', 'fold', 'changed']) {
      const action = scenario === 'changed' ? 'raise' : scenario;
      for (const phase of ['start', 'middle', 'end']) {
        const file = `texas-player-action-${action}-${phase}.png`;
        const generated = PNG.sync.read(readFileSync(path.join(directory, 'snapshots', scenario, file)));
        const input = action === 'check' && phase === 'middle'
          ? path.join(root, 'android/fixtures/player-action/check-middle.png') : path.join(snapshots, file);
        assert.deepEqual(generated.data, PNG.sync.read(readFileSync(input)).data,
          '必须实际生成本轮完整候选图片，不能仅断言采集 API 被调用');
      }
    }
    for (const scenario of ['jump', 'static', 'unfinished']) {
      assert.equal(existsSync(path.join(directory, 'snapshots', scenario)), false,
        '不完整或静止轨迹不能写出成功候选');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
