"""Fault injection for the dedicated CI lifecycle smoke, never production tests."""

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from diagnostics_lifecycle import group_members
from diagnostics_wrappers import install


def prepare(case):
    install()
    if case != 'retained-pipe':
        return
    sdk = Path(os.environ['ANDROID_HOME']) / 'emulator'
    original = sdk / 'emulator.diagnostics-original'
    original.rename(sdk / 'emulator.smoke-original')
    original.write_text(f'#!{sys.executable}\nimport sys\n'
                        f'sys.path.insert(0, {str(Path(__file__).resolve().parent)!r})\n'
                        'from ci_diagnostics_smoke_process import retain_pipe\n'
                        f'sys.exit(retain_pipe({str(sdk / "emulator.smoke-original")!r}, sys.argv[1:]))\n')
    original.chmod(0o755)


def retain_pipe(original, arguments):
    """Run the real emulator with a stubborn descendant inheriting its log pipe."""
    child = subprocess.Popen([sys.executable, '-c',
                              'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); '
                              'print("retained-output-child-ready", flush=True); time.sleep(1200)'])
    directory = Path(os.environ['ANDROID_DIAGNOSTICS_DIR'])
    (directory / 'smoke-processes.json').write_text(json.dumps({'pgid': os.getpgrp(), 'child': child.pid}))
    return subprocess.call([original, *arguments])


def cancel_test(cli, directory):
    """Deliver the same first cancellation signal as the Actions runner."""
    ready = directory / 'cancellation-ready'
    process = subprocess.Popen([*cli, 'run', '--', sys.executable, '-c',
                                'import pathlib,sys,time; pathlib.Path(sys.argv[1]).touch(); time.sleep(600)',
                                str(ready)])
    try:
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        assert ready.exists(), 'Cancellation fixture did not start'
        (directory / 'smoke-test.pgid').write_text((directory / 'test-process.pid').read_text())
        process.send_signal(signal.SIGINT)
        assert process.wait(timeout=20) == 130, 'Cancellation status lost'
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=2)


def verify_processes(directory):
    for filename in ['smoke-emulator.pgid', 'smoke-test.pgid']:
        path = directory / filename
        if path.exists():
            assert not group_members(int(path.read_text())), f'{filename} still alive'
    path = directory / 'smoke-processes.json'
    if path.exists():
        assert not group_members(json.loads(path.read_text())['pgid']), 'Retained pipe child still alive'
    for filename in ['emulator-wrapper.pid', 'emulator-process.pid', 'test-process.pid', 'collector.pid', 'ready']:
        assert not (directory / filename).exists(), f'{filename} not cleaned'
    assert not list(directory.glob('diagnostic-process-*.pid')), 'Diagnostic process registrations remain'
    sdk = Path(os.environ['ANDROID_HOME'])
    for relative in ['emulator/emulator', 'platform-tools/adb']:
        assert not (sdk / (relative + '.diagnostics-original')).exists(), 'SDK wrapper not restored'
    original = Path(os.environ['ANDROID_HOME']) / 'emulator/emulator.smoke-original'
    if original.exists():
        original.replace(original.with_name('emulator'))
