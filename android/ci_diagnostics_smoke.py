"""Exercise diagnostics against a real CI emulator without application credentials."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parent
DIRECTORY = Path(os.environ.get('ANDROID_DIAGNOSTICS_DIR', ROOT / 'artifacts/diagnostics'))
CLI = [sys.executable, str(ROOT / 'ci_diagnostics.py')]
ADB = ['adb', '-s', os.environ.get('ANDROID_SERIAL', 'emulator-5554')]


def command(arguments, expected=0, timeout=120):
    """Check exit status without copying command arguments or raw logs to CI output."""
    result = subprocess.run(arguments, timeout=timeout, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, check=False)
    if result.returncode != expected:
        raise AssertionError(f'Command returned {result.returncode}; expected {expected}')


def contents(name):
    return ''.join(path.read_text() for path in sorted(DIRECTORY.glob(f'{name}.log*')))


def marker(name):
    """Wait for the streaming collector to observe a real Android log entry."""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        command([*ADB, 'shell', 'log', '-p', 'i', '-t', 'CI_DIAGNOSTICS',
                 name + ' ' + os.environ['DIAGNOSTICS_SMOKE_TOKEN']])
        if name in contents('logcat'):
            return
        time.sleep(0.5)
    raise AssertionError(f'Logcat collector did not retain {name}')


def exercise():
    """Prove child status retention and continuous logs across adbd restart."""
    command([*CLI, 'run', '--', sys.executable, '-c', 'raise SystemExit(0)'])
    command([*CLI, 'run', '--', sys.executable, '-c', 'raise SystemExit(23)'], expected=23)
    marker('CI_DIAG_BEFORE_RECONNECT')
    command([*ADB, 'logcat', '-c'])
    command([*ADB, 'root'])
    command([*ADB, 'wait-for-device'])
    marker('CI_DIAG_AFTER_RECONNECT')
    assert 'CI_DIAG_BEFORE_RECONNECT' in contents('logcat'), 'Earlier log lost after restart'
    assert 'test_exit=23' in contents('lifecycle'), 'Original failed exit not retained'
    assert 'test_exit=0' in contents('lifecycle'), 'Successful exit not retained'


def verify(case, outcome):
    """Validate the exact directory that the workflow uploads, after shutdown."""
    expected = 'failure' if case == 'init-failure' else 'success'
    assert outcome == expected, f'Emulator action outcome {outcome}; expected {expected}'
    for name in ['lifecycle', 'adb', 'host', 'emulator', 'cleanup']:
        assert contents(name), f'Missing {name} diagnostics'
    assert 'before-emulator-shutdown' in contents('lifecycle'), 'Final collection ran too late'
    assert 'cleanup_exit=' in contents('cleanup'), 'Emulator cleanup result missing'
    if case == 'normal':
        for marker_name in ['CI_DIAG_BEFORE_RECONNECT', 'CI_DIAG_AFTER_RECONNECT']:
            assert marker_name in contents('logcat'), f'Missing {marker_name}'
            assert any(marker_name in line and '[REDACTED]' in line
                       for line in contents('logcat').splitlines()), 'Marker did not prove secret filtering'
        assert 'test_exit=23' in contents('lifecycle'), 'Failed command exit missing'
    else:
        assert 'phase=test-start' not in contents('lifecycle'), 'Tests ran after failed initialization'
    secret = os.environ['DIAGNOSTICS_SMOKE_TOKEN']
    for path in DIRECTORY.glob('*.log*'):
        data = path.read_text()
        assert secret not in data, f'Unredacted sentinel in {path.name}'
        for line in data.splitlines():
            assert re.match(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', line), f'Missing timestamp in {path.name}'
    report = {'case': case, 'run_id': os.environ['GITHUB_RUN_ID'],
              'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'action_outcome': outcome,
              'timestamped_logs': True, 'redaction_verified': True,
              'collected_before_shutdown': True}
    (DIRECTORY / 'smoke-validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Android diagnostics smoke validated: {case}')


if __name__ == '__main__':
    if sys.argv[1] == 'exercise':
        exercise()
    elif sys.argv[1] == 'verify':
        verify(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit('Expected exercise or verify')
