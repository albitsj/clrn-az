import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assetFrameCommand } from './asset-driver.mjs';

const driverSource = readFileSync(new URL('./build-driver.mjs', import.meta.url), 'utf8');
const motionCommand = driverSource.slice(driverSource.indexOf('case "challengeFrames":'),
  driverSource.indexOf('case "transientFrames":'));
const scenarios = [
  { title: '生产 Java 区域命令保留完整时间窗、实际时间戳和无损帧，并限制内存及回收异常路径',
    source: assetFrameCommand, placeholder: '// ASSET_FRAME_COMMAND', args: [],
    result: /native region sampling, cadence, memory, bounds and cleanup passed/ },
  { title: '生产 Java 比牌命令在首帧缓慢时仍覆盖四秒，保留既有位图上限及普通采样边界',
    source: motionCommand, placeholder: '// MOTION_FRAME_COMMAND', args: ['motion'],
    result: /native motion first-frame latency, bounded window and cleanup passed/ },
];

for (const scenario of scenarios) test(scenario.title, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-asset-driver-'));
  try {
    const command = scenario.source.replaceAll('android.graphics.Bitmap', 'Bitmap')
      .replaceAll('android.os.SystemClock', 'Clock').replaceAll('android.util.Base64', 'Base64');
    const fixture = readFileSync(new URL('./fixtures/asset-driver/AssetDriverTest.java', import.meta.url), 'utf8');
    writeFileSync(path.join(directory, 'AssetDriverTest.java'), fixture.replace(scenario.placeholder, command));
    execFileSync('javac', ['AssetDriverTest.java'], { cwd: directory, timeout: 30_000 });
    const output = execFileSync('java', ['-cp', directory, 'AssetDriverTest', ...scenario.args], { encoding: 'utf8', timeout: 30_000 });
    assert.match(output, scenario.result);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
