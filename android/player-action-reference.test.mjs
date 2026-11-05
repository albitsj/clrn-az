import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshots = path.join(root, 'android/snapshots/android-35-x86_64-720x1280-en');
const actions = ['call', 'raise', 'check', 'fold'];

/** 为 check 构造有明确像素预期的半透明采样输入；其他相位复用原图。
 * check 的正式 middle 是极早相位，单帧不足以代表完整录屏的候选帧。
 * 此合成输入仅测试采集控制流，不冒充真实录像或正式基准。
 * @param action - 当前玩家动作。
 */
function phases(action) {
  const images = ['start', 'middle', 'end'].map(phase =>
    readFileSync(path.join(snapshots, `texas-player-action-${action}-${phase}.png`)));
  if (action === 'check') {
    const before = PNG.sync.read(images[0]), after = PNG.sync.read(images[2]);
    for (let offset = 0; offset < before.data.length; offset++) {
      before.data[offset] = Math.round((before.data[offset] + after.data[offset]) / 2);
    }
    images[1] = PNG.sync.write(before);
  }
  return images;
}

/** 在真实 Playwright 报告/快照上下文中执行生产准备和完整录屏比较。
 * @param directory - 只在临时目录生成待采集基准。
 * @param mode - 首次采集或严格比较。
 */
function run(directory, mode) {
  writeFileSync(path.join(directory, 'playwright.config.mjs'), `
    import { defineConfig } from ${JSON.stringify(path.join(root, 'node_modules/@playwright/test/index.mjs'))};
    export default defineConfig({ testDir: '.', testMatch: 'capture.spec.mjs', workers: 1,
      retries: 0, updateSnapshots: ${JSON.stringify(mode)}, reporter: 'json', outputDir: './results',
      snapshotPathTemplate: '{testDir}/snapshots/local/{arg}{ext}' });
  `);
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'),
    'test', '--config', path.join(directory, 'playwright.config.mjs')],
  { cwd: directory, env: { ...process.env, ANDROID_LOCALE: 'en' }, encoding: 'utf8',
    timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, [], result.stderr);
  assert.equal(result.status, 0, result.stderr);
  return report.suites.flatMap(suite => suite.specs.map(spec => ({ title: spec.title,
    status: spec.tests[0].results[0].status, error: spec.tests[0].results[0].error?.message })));
}

test('无本地旧图的四种动作完成 reference 采集，compare 继续拒绝错误首尾、轨迹和缺图', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-player-action-reference-'));
  try {
    for (const action of actions) for (const [index, phase] of ['start', 'middle', 'end'].entries()) {
      writeFileSync(path.join(directory, `${action}-${phase}.png`), phases(action)[index]);
    }
    writeFileSync(path.join(directory, 'capture.spec.mjs'), `
      import assert from 'node:assert/strict';
      import { existsSync, readFileSync } from 'node:fs';
      import path from 'node:path';
      import { test } from ${JSON.stringify(path.join(root, 'node_modules/@playwright/test/index.mjs'))};
      import { PNG } from ${JSON.stringify(path.join(root, 'node_modules/pngjs/lib/png.js'))};
      import { playerActionRegion, waitForPlayerActionStart } from ${JSON.stringify(path.join(root, 'android/texas-support.ts'))};
      import { captureNativeTransition } from ${JSON.stringify(path.join(root, 'android/animation-transition.ts'))};
      const inputs = ${JSON.stringify(directory)};
      const stale = readFileSync(${JSON.stringify(path.join(root, 'android/fixtures/player-action/raise-start-with-call.png'))});
      /** 只替换设备输入；局部分区仍来自已有的原始 PNG。
       * @param bytes - 指定采样相位的真实分区。
       */
      function screen(bytes) {
        const result = new PNG({ width: 720, height: 1280 });
        const part = PNG.sync.read(bytes);
        PNG.bitblt(part, result, 0, 0, part.width, part.height, playerActionRegion.x, playerActionRegion.y);
        return PNG.sync.write(result).toString('base64');
      }
      for (const action of ${JSON.stringify(actions)}) {
        for (const variant of ['valid', 'wrong-start', 'wrong-end', 'wrong-middle', 'missing']) {
          test(action + ' / ' + variant, async ({}, info) => {
            const reference = info.config.updateSnapshots === 'all';
            test.skip(reference && variant !== 'valid');
            test.fail(!reference && variant !== 'valid');
            const name = 'texas-player-action-' + action;
            const phases = ['start', 'middle', 'end'].map(phase => readFileSync(path.join(inputs, action + '-' + phase + '.png')));
            if (reference) assert.equal(existsSync(info.snapshotPath(name + '-start.png')), false);
            const captured = phases.map((bytes, index) => {
              if (variant !== 'wrong-' + ['start', 'middle', 'end'][index]) return bytes;
              const wrong = PNG.sync.read(bytes);
              const width = index === 1 ? wrong.width : 20;
              const height = index === 1 ? wrong.height : 20;
              for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const offset = (y * wrong.width + x) * 4;
                wrong.data.fill(255, offset, offset + 3);
              }
              return PNG.sync.write(wrong);
            });
            let reads = 0, prepared = false, triggered = false;
            const device = { _connection: { toImpl: () => ({ _send: async method => {
              assert.equal(method, 'screen');
              reads++;
              return screen(!prepared ? (reads < 3 ? stale : phases[0]) : triggered ? captured[2] : captured[0]);
            } }) } };
            await waitForPlayerActionStart(device, info, action);
            assert.equal(reads, 3, '旧 call 仍可见的前两帧不能通过准备条件');
            prepared = true;
            if (variant === 'missing') info.snapshotPath = file => path.join(${JSON.stringify(directory)}, 'absent', file);
            await captureNativeTransition(device, name, info, playerActionRegion,
              () => { triggered = true; }, [], [], 0, 'videoFrames',
              undefined, undefined, [], [], [], [], async (_name, _region, trigger) => {
                await trigger();
                return captured;
              });
            assert.equal(triggered, true);
          });
        }
      }
    `);
    const reference = run(directory, 'all');
    assert.deepEqual(reference.filter(item => item.status !== 'skipped').map(item => [item.title, item.status]),
      actions.map(action => [`${action} / valid`, 'passed']), JSON.stringify(reference));
    for (const action of actions) for (const [index, phase] of ['start', 'middle', 'end'].entries()) {
      const file = `texas-player-action-${action}-${phase}.png`;
      assert.deepEqual(PNG.sync.read(readFileSync(path.join(directory, 'snapshots/local', file))).data,
        PNG.sync.read(phases(action)[index]).data, `${file} 必须保存实际输入的相位像素`);
    }
    const comparison = run(directory, 'none');
    for (const action of actions) {
      const outcomes = comparison.filter(item => item.title.startsWith(`${action} / `));
      assert.deepEqual(outcomes.map(item => item.status), ['passed', 'failed', 'failed', 'failed', 'failed'],
        JSON.stringify(outcomes));
      for (const [index, message] of [[1, /动画起点视觉回归/], [2, /动画终点视觉回归/],
        [3, /动画中途帧的实际画面须接近已审查轨迹/], [4, /ENOENT/]]) {
        assert.match(outcomes[index].error, message);
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
