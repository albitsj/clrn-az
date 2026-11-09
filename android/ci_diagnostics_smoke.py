"""Exercise diagnostics against a real CI emulator without application credentials."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from diagnostics_io import BoundedLog, Redactor


ROOT = Path(__file__).resolve().parent
DIRECTORY = Path(os.environ.get('ANDROID_DIAGNOSTICS_DIR', ROOT / 'artifacts/diagnostics'))
CLI = [sys.executable, str(ROOT / 'ci_diagnostics.py')]
ADB = ['adb', '-s', os.environ.get('ANDROID_SERIAL', 'emulator-5554')]


def command(arguments, expected=0, timeout=120):
    """Check exit status without copying command arguments or raw logs to CI output."""
    result = subprocess.run(arguments, timeout=timeout, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, check=False)
    BoundedLog(DIRECTORY, 'smoke', Redactor()).write(result.stdout.decode('utf-8', errors='replace'))
    if result.returncode != expected:
        raise AssertionError(f'Command returned {result.returncode}; expected {expected}')


def contents(name):
    return ''.join(path.read_text() for path in sorted(DIRECTORY.glob(f'{name}.log*')))


def checkpoint_marker(name):
    """先验证并保存已采集的真实脱敏标记，不能要求有界日志无限保留旧行。"""
    matches = [line for line in contents('logcat').splitlines() if name in line]
    if not matches:
        return False
    observed = '\n'.join(matches)
    assert '[REDACTED]' in observed, 'Marker did not prove secret filtering'
    assert os.environ['DIAGNOSTICS_SMOKE_TOKEN'] not in observed, 'Unredacted marker'
    # 保存原有脱敏行，不再次用环境凭据脱敏，以免掩盖采集器的真实过滤失败。
    BoundedLog(DIRECTORY, 'smoke-markers', Redactor({})).write(observed)
    return True


def marker(name):
    """Wait for the streaming collector to observe a real Android log entry."""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        command([*ADB, 'shell', 'log', '-p', 'i', '-t', 'CI_DIAGNOSTICS',
                 name + ' ' + os.environ['DIAGNOSTICS_SMOKE_TOKEN']])
        if checkpoint_marker(name):
            return
        time.sleep(0.5)
    raise AssertionError(f'Logcat collector did not retain {name}')


def exercise(case='normal'):
    """Prove child status retention and continuous logs across adbd restart."""
    command([*CLI, 'run', '--', sys.executable, '-c', 'raise SystemExit(0)'])
    command([*CLI, 'run', '--', sys.executable, '-c', 'raise SystemExit(23)'], expected=23)
    if case == 'normal':
        # Keep the existing reconnect scenario; lifecycle fault cases are separate
        # so a setup transport restart cannot prevent their fault injection.
        marker('CI_DIAG_BEFORE_RECONNECT')
        command([*ADB, 'logcat', '-c'])
        command([*ADB, 'root'])
        command([*ADB, 'wait-for-device'])
        marker('CI_DIAG_AFTER_RECONNECT')
        assert 'CI_DIAG_BEFORE_RECONNECT' in contents('logcat'), 'Earlier log lost after restart'
    else:
        marker('CI_DIAG_LIFECYCLE_READY')
    assert 'test_exit=23' in contents('lifecycle'), 'Original failed exit not retained'
    assert 'test_exit=0' in contents('lifecycle'), 'Successful exit not retained'
    (DIRECTORY / 'smoke-emulator.pgid').write_text((DIRECTORY / 'emulator-process.pid').read_text())
    if case == 'test-failure':
        raise SystemExit(23)
    if case == 'cancel':
        from ci_diagnostics_smoke_process import cancel_test
        cancel_test(CLI, DIRECTORY)
        raise SystemExit(130)
    if case == 'unresponsive':
        import signal
        os.killpg(int((DIRECTORY / 'emulator-process.pid').read_text()), signal.SIGSTOP)


def verify(case, outcome, cleanup_outcome):
    """Validate the exact directory that the workflow uploads, after shutdown."""
    expected = 'failure' if case in ['init-failure', 'test-failure', 'cancel'] else 'success'
    assert outcome == expected, f'Emulator action outcome {outcome}; expected {expected}'
    cleanup_expected = 'failure' if case in ['init-failure', 'unresponsive', 'retained-pipe'] else 'success'
    assert cleanup_outcome == cleanup_expected, f'Cleanup outcome {cleanup_outcome}; expected {cleanup_expected}'
    from ci_diagnostics_smoke_process import verify_processes
    verify_processes(DIRECTORY)
    for name in ['lifecycle', 'adb', 'host', 'emulator', 'cleanup']:
        assert contents(name), f'Missing {name} diagnostics'
    assert 'before-emulator-shutdown' in contents('lifecycle'), 'Final collection ran too late'
    assert 'cleanup_exit=' in contents('cleanup'), 'Emulator cleanup result missing'
    if case != 'init-failure':
        markers = ['CI_DIAG_BEFORE_RECONNECT', 'CI_DIAG_AFTER_RECONNECT'] if case == 'normal' else [
            'CI_DIAG_LIFECYCLE_READY']
        observed = contents('logcat') + '\n' + contents('smoke-markers')
        for marker_name in markers:
            assert marker_name in observed, f'Missing {marker_name}'
            assert any(marker_name in line and '[REDACTED]' in line
                       for line in observed.splitlines()), 'Marker did not prove secret filtering'
        assert 'test_exit=23' in contents('lifecycle'), 'Failed command exit missing'
    else:
        assert 'phase=test-start' not in contents('lifecycle'), 'Tests ran after failed initialization'
    if case == 'cancel':
        assert 'test_exit=130' in contents('lifecycle'), 'Cancellation status missing'
    if case == 'unresponsive':
        assert 'phase=emulator-shutdown timeout' in contents('emulator'), 'Shutdown timeout not exercised'
    if case == 'retained-pipe':
        assert 'phase=output-drain timeout' in contents('emulator'), 'Pipe timeout not exercised'
    if case == 'graceful-stop':
        assert 'phase=emulator-shutdown graceful-stop' in contents('emulator'), 'Graceful stop not exercised'
        assert 'emulator_exit=0' in contents('emulator'), 'Native emulator did not exit normally'
    secret = os.environ['DIAGNOSTICS_SMOKE_TOKEN']
    for path in DIRECTORY.glob('*.log*'):
        data = path.read_text()
        assert secret not in data, f'Unredacted sentinel in {path.name}'
        for line in data.splitlines():
            assert re.match(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', line), f'Missing timestamp in {path.name}'
    report = {'case': case, 'run_id': os.environ['GITHUB_RUN_ID'],
              'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'action_outcome': outcome,
              'cleanup_outcome': cleanup_outcome, 'processes_stopped': True,
              'timestamped_logs': True, 'redaction_verified': True,
              'collected_before_shutdown': True}
    (DIRECTORY / 'smoke-validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Android diagnostics smoke validated: {case}')


if __name__ == '__main__':
    if sys.argv[1] == 'exercise':
        exercise(sys.argv[2] if len(sys.argv) > 2 else 'normal')
    elif sys.argv[1] == 'prepare':
        from ci_diagnostics_smoke_process import prepare
        prepare(sys.argv[2])
    elif sys.argv[1] == 'verify':
        verify(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit('Expected exercise or verify')
