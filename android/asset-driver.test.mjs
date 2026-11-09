import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assetFrameCommand } from './asset-driver.mjs';

test('生产 Java 区域命令保留完整时间窗、实际时间戳和无损帧，并限制内存及回收异常路径', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-asset-driver-'));
  try {
    const command = assetFrameCommand.replaceAll('android.graphics.Bitmap', 'Bitmap')
      .replaceAll('android.os.SystemClock', 'Clock').replaceAll('android.util.Base64', 'Base64');
    const fixture = readFileSync(new URL('./fixtures/asset-driver/AssetDriverTest.java', import.meta.url), 'utf8');
    writeFileSync(path.join(directory, 'AssetDriverTest.java'), fixture.replace('// ASSET_FRAME_COMMAND', command));
    execFileSync('javac', ['AssetDriverTest.java'], { cwd: directory, timeout: 30_000 });
    const output = execFileSync('java', ['-cp', directory, 'AssetDriverTest'], { encoding: 'utf8', timeout: 30_000 });
    assert.match(output, /native region sampling, cadence, memory, bounds and cleanup passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
