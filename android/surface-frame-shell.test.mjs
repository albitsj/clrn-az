import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { surfaceRecordingCommand } = require('./surface-frame-recording.ts');

test('真实 shell 关闭录制后管道立即释放，保险 sleep 不得继承 ADB 输出管道', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-surface-shell-test-'));
  const binary = path.join(directory, 'screenrecord');
  writeFileSync(binary, '#!/usr/bin/env node\nprocess.on("SIGINT", () => process.exit(0));\n'
    + 'process.stdout.write("ready");\nsetInterval(() => {}, 1000);\n', { mode: 0o755 });
  const child = spawn(process.env.CLRN_SURFACE_TEST_SHELL || 'sh', ['-c', surfaceRecordingCommand], { env: {
    ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const closed = once(child, 'close');
  const controller = new AbortController();
  try {
    const startup = setTimeout(4000, undefined, { signal: controller.signal }).then(() => {
      throw new Error('测试录制进程未就绪');
    });
    await Promise.race([once(child.stdout, 'data'), startup]);
    await setTimeout(60);
    const deadline = setTimeout(1500, undefined, { signal: controller.signal }).then(() => {
      throw new Error('保险进程仍持有录制管道');
    });
    const pid = /^CLRN_FRAME_PID=([1-9][0-9]*)$/m.exec(stderr)?.[1];
    assert.ok(pid);
    process.kill(Number(pid), 'SIGINT');
    const [code] = await Promise.race([closed, deadline]);
    assert.equal(code, 0);
  } finally {
    controller.abort();
    child.kill('SIGKILL');
    child.stdout.destroy();
    child.stderr.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
});
