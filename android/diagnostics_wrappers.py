"""Capture emulator output and snapshot the device before the action stops it."""

import os
from pathlib import Path
import signal
import sys
import threading

from diagnostics_io import capture


SUFFIX = '.diagnostics-original'


def install():
    from ci_diagnostics import ROOT, collector
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
    diagnostics = collector()
    try:
        install_binaries(sdk, diagnostics, ROOT)
    except Exception:
        restore()
        raise


def install_binaries(sdk, diagnostics, root):
    for relative, kind in [('emulator/emulator', 'emulator'), ('platform-tools/adb', 'adb')]:
        executable = sdk / relative
        original = executable.with_name(executable.name + SUFFIX)
        if original.exists():
            continue
        executable.rename(original)
        wrapper = (f'#!{sys.executable}\nimport sys\n'
                   f'sys.path.insert(0, {str(root)!r})\n'
                   'from diagnostics_wrappers import wrapped\n'
                   f'sys.exit(wrapped({kind!r}, {str(original)!r}, sys.argv[1:]))\n')
        try:
            executable.write_text(wrapper)
            executable.chmod(0o755)
        except Exception:
            original.replace(executable)
            raise
        diagnostics.logs['lifecycle'].write(f'installed {kind} diagnostics wrapper')


def restore():
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not sdk:
        return
    for relative in ['emulator/emulator', 'platform-tools/adb']:
        executable = Path(sdk) / relative
        original = executable.with_name(executable.name + SUFFIX)
        if original.exists():
            original.replace(executable)


def wrapped(kind, original, arguments):
    from ci_diagnostics import best_effort, collector
    command = [original, *arguments]
    if kind == 'adb' and any(arguments[index:index + 2] == ['emu', 'kill']
                             for index in range(len(arguments) - 1)):
        diagnostics = best_effort(collector)
        if diagnostics is None:
            os.execv(original, command)
        best_effort(lambda: diagnostics.sample('before-emulator-shutdown'))
        result = capture(command, diagnostics.logs['cleanup'], timeout=30)
        best_effort(lambda: diagnostics.logs['cleanup'].write(f'cleanup_exit={result}'))
        return result if result >= 0 else 128 - result
    if kind == 'emulator' and ('-avd' in arguments or any(arg.startswith('@') for arg in arguments)):
        diagnostics = best_effort(collector)
        if diagnostics is None:
            os.execv(original, command)
        stopped = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stopped.set())
        signal.signal(signal.SIGINT, lambda *_: stopped.set())
        best_effort(lambda: diagnostics.logs['emulator'].write('emulator launch'))
        result = capture(command, diagnostics.logs['emulator'], timeout=None, stop=stopped)
        best_effort(lambda: diagnostics.logs['emulator'].write(f'emulator_exit={result}'))
        return result if result >= 0 else 128 - result
    # Never record command arguments: test input may contain passwords and tokens.
    os.execv(original, command)
