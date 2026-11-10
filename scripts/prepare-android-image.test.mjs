import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = fileURLToPath(new URL('./prepare-android-image.sh', import.meta.url));
const timeoutFixture = `#!/usr/bin/env bash
printf '%s|%s|%s\\n' "$1" "$2" "$4" >> "$SDK_CALLS"
shift 2
exec "$@"
`;
const managerFixture = `#!/usr/bin/env bash
set -eu
stage="$1"
counter="$SDK_FIXTURE/$stage-count"
count=0
if [ -f "$counter" ]; then count=$(cat "$counter"); fi
count=$((count + 1))
printf '%s' "$count" > "$counter"
if [ "$stage" = "$SDK_FAIL_STAGE" ] && [ "$count" -le "$SDK_FAIL_COUNT" ]; then
  if [ "$stage" = --install ]; then
    mkdir -p "$SDK_IMAGE"
    printf partial > "$SDK_IMAGE/system.img"
  fi
  exit 124
fi
if [ "$stage" = --licenses ]; then
  read -r accepted
  test "$accepted" = y
elif [ "$SDK_MISSING_IMAGE" != 1 ]; then
  if [ "$SDK_REQUIRE_IMAGE" = 1 ]; then test -f "$SDK_IMAGE/system.img"; fi
  if [ "$count" -gt 1 ] && [ -f "$SDK_IMAGE/system.img" ]; then
    if [ "$(cat "$SDK_IMAGE/system.img")" = partial ]; then exit 77; fi
  fi
  mkdir -p "$SDK_IMAGE"
  printf complete > "$SDK_IMAGE/system.img"
fi
`;

/** 执行真实准备脚本，在外部 SDK 和 GNU timeout 边界模拟超时及缺失镜像。
 * @param options - 当前远端命令的失败模式。
 */
function prepare(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'clrn-sdk-preparation-'));
  const bin = path.join(root, 'bin'), sdk = path.join(root, 'sdk');
  const manager = path.join(sdk, 'cmdline-tools/latest/bin/sdkmanager');
  const image = path.join(sdk, 'system-images/android-35/google_apis/x86_64');
  mkdirSync(bin); mkdirSync(path.dirname(manager), { recursive: true });
  writeFileSync(manager, managerFixture, { mode: 0o700 });
  writeFileSync(path.join(bin, 'timeout'), timeoutFixture, { mode: 0o700 });
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  if (options.SDK_REQUIRE_IMAGE === '1') {
    mkdirSync(image, { recursive: true });
    writeFileSync(path.join(image, 'system.img'), 'existing');
  }
  const calls = path.join(root, 'calls');
  try {
    const result = spawnSync('bash', [script], { encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ANDROID_HOME: sdk,
        ANDROID_USER_HOME: path.join(root, 'android-user'), SDK_FIXTURE: root, SDK_IMAGE: image,
        SDK_CALLS: calls, SDK_FAIL_STAGE: '', SDK_FAIL_COUNT: '0', SDK_MISSING_IMAGE: '0',
        SDK_REQUIRE_IMAGE: '0', ...options } });
    assert.ifError(result.error);
    return { status: result.status, calls: readFileSync(calls, 'utf8').trim().split('\n'), stderr: result.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('真实 action 使用有界准备脚本，授权与安装均有 TERM 后强制结束期限', () => {
  const action = readFileSync(new URL('../.github/actions/android-visual/action.yml', import.meta.url), 'utf8');
  assert.ok(action.includes('run: bash scripts/prepare-android-image.sh'));
  assert.deepEqual(prepare(), { status: 0,
    calls: ['--kill-after=10s|120s|--licenses', '--kill-after=10s|600s|--install'], stderr: '' });
});

for (const stage of ['--licenses', '--install']) {
  test(`${stage} 超时必须有界失败，保持原三次上限`, () => {
    const result = prepare({ SDK_FAIL_STAGE: stage, SDK_FAIL_COUNT: '3' });
    assert.equal(result.status, 124);
    assert.equal(result.calls.filter(call => call.endsWith(stage)).length, 3);
    assert.match(result.stderr, /attempt=3 status=124/);
    if (stage === '--licenses') assert.equal(result.calls.length, 3);
  });

  test(`${stage} 首次超时后可以重新获取清单并成功准备真实镜像`, () => {
    const result = prepare({ SDK_FAIL_STAGE: stage, SDK_FAIL_COUNT: '1' });
    assert.equal(result.status, 0);
    assert.equal(result.calls.filter(call => call.endsWith('--licenses')).length, 2);
    assert.equal(result.calls.filter(call => call.endsWith(stage)).length, 2);
  });
}

test('SDK 返回成功但没有实际镜像仍然失败，不能误报准备完成', () => {
  const result = prepare({ SDK_MISSING_IMAGE: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 6);
});

test('授权清单超时后的重试保留已经存在的系统镜像', () => {
  const result = prepare({ SDK_FAIL_STAGE: '--licenses', SDK_FAIL_COUNT: '1', SDK_REQUIRE_IMAGE: '1' });
  assert.equal(result.status, 0);
  assert.equal(result.calls.length, 3);
});
