"""Capture emulator output and snapshot the device before the action stops it."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import threading

from diagnostics_io import capture
from diagnostics_lifecycle import failure, report, request_shutdown, signal_group, wait_emulator


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
    from ci_diagnostics import collector
    command = [original, *arguments]
    if kind == 'adb' and any(arguments[index:index + 2] == ['emu', 'kill']
                             for index in range(len(arguments) - 1)):
        return shutdown(command, collector())
    if kind == 'emulator' and ('-avd' in arguments or any(arg.startswith('@') for arg in arguments)):
        return emulator(command, collector())
    # Never record command arguments: test input may contain passwords and tokens.
    os.execv(original, command)


def shutdown(command, diagnostics, timeout=10):
    """Bound adb, emulator exit and wrapper completion as separate stages."""
    from ci_diagnostics import best_effort
    log = diagnostics.logs['cleanup']
    best_effort(lambda: diagnostics.sample('before-emulator-shutdown'), log)
    try:
        result = capture(command, log, timeout=timeout)
        log.write(f'cleanup_exit={result}')
        if result:
            failure(diagnostics.directory, log, f'phase=adb-emu-kill exit={result}')
    except Exception:
        failure(diagnostics.directory, log, 'phase=adb-emu-kill failed')
        raise
    finally:
        request_shutdown(diagnostics.directory)
    if not wait_emulator(diagnostics.directory, log):
        result = result or 124
    return result if result >= 0 else 128 - result


def observe_shutdown_threads(pid, log, finished):
    """Record bounded, argument-free wait states without affecting shutdown."""
    from ci_diagnostics import best_effort

    def snapshot():
        result = subprocess.run(
            ['ps', '-L', '-p', str(pid), '-o', 'pid,tid,stat,wchan:32,comm'],
            capture_output=True, text=True, timeout=2, check=True)
        report(log, 'phase=emulator-shutdown thread-waits\n' +
               '\n'.join(result.stdout.splitlines()[:256]))

    for delay in (0, 5, 10):
        if finished.wait(delay):
            return
        best_effort(snapshot, log)


def graceful_emulator_stop(diagnostics, finished, stopped):
    """控制台关闭未完成时正常终止已登记的进程组，仍保留原生退出结果。"""
    log = diagnostics.logs['emulator']
    try:
        pid = int((diagnostics.directory / 'emulator-process.pid').read_text())
        report(log, f'phase=emulator-shutdown graceful-stop pgid={pid}')
        signal_group(pid, signal.SIGTERM)
        from ci_diagnostics import best_effort
        best_effort(lambda: threading.Thread(
            target=observe_shutdown_threads, args=(pid, log, finished), daemon=True).start(), log)
    except FileNotFoundError:
        # 原生采集器确认进程组退出后可能刚刚移除登记。
        pass
    except (OSError, ValueError) as error:
        failure(diagnostics.directory, log, f'phase=emulator-termination failed: {type(error).__name__}')
    # SDK 正常关闭允许 20 秒；额外 5 秒用于采集器排空输出和回收进程组。
    if not finished.wait(25):
        report(log, 'phase=emulator-shutdown timeout after graceful-stop')
        stopped.set()


def emulator(command, diagnostics, shutdown_grace=10):
    """Release action-owned pipes and enforce a deadline after shutdown starts."""
    # emulator-runner starts us in the background. Holding its stdout/stderr open
    # can keep the Node action alive even after its emu kill command has returned.
    with open(os.devnull, 'r+b') as sink:
        for descriptor in (0, 1, 2):
            os.dup2(sink.fileno(), descriptor)
    stopped = threading.Event()
    finished = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    log = diagnostics.logs['emulator']
    pidfile = diagnostics.directory / 'emulator-wrapper.pid'
    (diagnostics.directory / 'emulator.started').touch()
    pidfile.write_text(str(os.getpid()))

    def watch_shutdown():
        while not finished.wait(0.1):
            if (diagnostics.directory / 'shutdown-requested').exists():
                log.write('phase=emulator-shutdown requested')
                if not finished.wait(shutdown_grace):
                    report(log, f'phase=emulator-shutdown console-grace-expired after {shutdown_grace}s')
                    graceful_emulator_stop(diagnostics, finished, stopped)
                return

    threading.Thread(target=watch_shutdown, daemon=True).start()
    log.write('emulator launch')
    try:
        result = capture(command, log, timeout=None, stop=stopped, stop_status=124,
                         pidfile=diagnostics.directory / 'emulator-process.pid')
        log.write(f'emulator_exit={result}')
        (diagnostics.directory / 'emulator.exit').write_text(str(result))
        if result == 124:
            failure(diagnostics.directory, log, 'phase=emulator-cleanup timed out; process group killed')
        elif result:
            failure(diagnostics.directory, log, f'phase=emulator-cleanup exit={result}')
        return result if result >= 0 else 128 - result
    finally:
        finished.set()
        pidfile.unlink(missing_ok=True)
