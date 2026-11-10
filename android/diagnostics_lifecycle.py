"""Bounded process cleanup shared by the test and SDK diagnostics wrappers."""

import os
import signal
import subprocess
import threading
import time


def report(log, message):
    """A broken diagnostics disk must not prevent process termination."""
    if log is not None:
        try:
            log.write(message)
        except OSError:
            pass


def failure(directory, log, message):
    """Persist cleanup failure separately from the original test exit code."""
    print(f'Android cleanup failed: {message}', flush=True)
    try:
        (directory / 'cleanup-failed').touch()
    except OSError:
        print('Android cleanup failure marker could not be written.', flush=True)
    report(log, message)


def group_members(pid):
    """Inspect process identity/state only; never expose argv or environment."""
    result = subprocess.run(['ps', '-eo', 'pid,ppid,pgid,stat,comm'],
                            capture_output=True, text=True, timeout=2, check=True)
    return [line for line in result.stdout.splitlines()[1:]
            if len(fields := line.split()) >= 5 and fields[2] == str(pid)
            and not fields[3].startswith('Z')]


def signal_group(pid, sig):
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass


def wait_group_exit(pid, timeout=2):
    """Allow a bounded interval for signalled descendants to leave the group."""
    deadline = time.monotonic() + timeout
    while group_members(pid):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.05)
    return True


def finish_group(process, report, grace=2):
    """Reap the leader and stop descendants even when they closed their pipes."""
    process.poll()
    members = group_members(process.pid)
    if not members:
        return True
    report(f'phase=process-cleanup pgid={process.pid}\n' + '\n'.join(members))
    signal_group(process.pid, signal.SIGTERM)
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        process.poll()
        if not group_members(process.pid):
            return True
        time.sleep(0.1)
    report(f'phase=process-cleanup timeout; SIGKILL pgid={process.pid}')
    signal_group(process.pid, signal.SIGKILL)
    process.wait(timeout=2)
    return False


def request_shutdown(directory):
    (directory / 'shutdown-requested').touch()


def register_process(directory, pidfile, pid, write):
    try:
        directory.mkdir(parents=True, exist_ok=True)
        pidfile.write_text(str(pid))
    except OSError:
        write('test process registration unavailable')


def run_test(command, directory, log):
    """Forward cancellation and clean the whole test group before returning."""
    cancelled = threading.Event()
    received = []

    def on_signal(sig, _frame):
        received.append(sig)
        cancelled.set()

    def report(message):
        if log is not None:
            try:
                log.write(message)
            except OSError:
                pass

    previous = {sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM)}
    pidfile = directory / 'test-process.pid'
    try:
        process = subprocess.Popen(command, start_new_session=True)
        register_process(directory, pidfile, process.pid, report)
        while process.poll() is None and not cancelled.wait(0.1):
            pass
        status = 128 + received[0] if received else process.returncode
        status = status if status >= 0 else 128 - status
        # Write the test result before cleanup: later failures must not erase it.
        try:
            (directory / 'test.exit').write_text(str(status))
            if not finish_group(process, report):
                failure(directory, log, 'phase=test-process-cleanup required SIGKILL')
        except (OSError, subprocess.SubprocessError):
            signal_group(process.pid, signal.SIGKILL)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            failure(directory, log, 'phase=test-process-cleanup failed')
        return status
    finally:
        pidfile.unlink(missing_ok=True)
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def stop_test(directory, log):
    """Recover a test group if cancellation killed its Python supervisor first."""
    pidfile = directory / 'test-process.pid'
    if not pidfile.exists():
        return
    pid = int(pidfile.read_text())
    members = group_members(pid)
    if members:
        report(log, f'phase=test-process-recovery pgid={pid}\n' + '\n'.join(members))
        signal_group(pid, signal.SIGTERM)
        time.sleep(2)
        if group_members(pid):
            signal_group(pid, signal.SIGKILL)
            failure(directory, log, 'phase=test-process-recovery required SIGKILL')
    pidfile.unlink(missing_ok=True)


def stop_captures(directory, log):
    """Recover independent probe/logcat sessions after a collector is killed."""
    for pidfile in directory.glob('diagnostic-process-*.pid'):
        try:
            pid = int(pidfile.read_text())
            try:
                members = group_members(pid)
            except (OSError, subprocess.SubprocessError):
                members = ['process snapshot unavailable']
            if members:
                report(log, f'phase=diagnostic-process-recovery pgid={pid}\n' + '\n'.join(members))
                signal_group(pid, signal.SIGKILL)
                failure(directory, log, 'phase=diagnostic-process-recovery required SIGKILL')
                try:
                    exited = wait_group_exit(pid)
                except (OSError, subprocess.SubprocessError):
                    failure(directory, log, f'phase=diagnostic-process-recovery pgid={pid} exit unverified; '
                            'retaining registration')
                    continue
                if not exited:
                    failure(directory, log, f'phase=diagnostic-process-recovery pgid={pid} still alive; '
                            'retaining registration')
                    continue
            pidfile.unlink(missing_ok=True)
        except FileNotFoundError:
            # A normally exiting capture may remove its registration concurrently.
            pass


def check_emulator_exit(directory, log):
    """An absent wrapper is successful only with a valid native exit result."""
    exitfile = directory / 'emulator.exit'
    if not (directory / 'emulator.started').exists() and not exitfile.exists():
        return True
    try:
        result = int(exitfile.read_text())
    except FileNotFoundError:
        failure(directory, log, 'phase=emulator-wrapper missing exit result')
    except (OSError, ValueError):
        failure(directory, log, 'phase=emulator-wrapper invalid exit result')
    else:
        if not result:
            return True
        failure(directory, log, f'phase=emulator-wrapper exit={result}')
    return False


def wait_emulator(directory, log, timeout=40):
    """Do not rely on emulator-runner propagating errors from adb emu kill."""
    # 包含控制台 10 秒、SDK 正常关闭 20 秒及采集器回收预算，仍有固定上限。
    pidfile = directory / 'emulator-wrapper.pid'
    deadline = time.monotonic() + timeout
    while pidfile.exists() and time.monotonic() < deadline:
        time.sleep(0.1)
    if not pidfile.exists():
        return check_emulator_exit(directory, log) and not (directory / 'cleanup-failed').exists()
    failure(directory, log, 'phase=emulator-wrapper timeout; terminating registered processes')
    childfile = directory / 'emulator-process.pid'
    if childfile.exists():
        pid = int(childfile.read_text())
        report(log, f'pgid={pid}\n' + '\n'.join(group_members(pid)))
        signal_group(pid, signal.SIGKILL)
    try:
        os.kill(int(pidfile.read_text()), signal.SIGTERM)
    except (ProcessLookupError, FileNotFoundError):
        pass
    deadline = time.monotonic() + 2
    while pidfile.exists() and time.monotonic() < deadline:
        time.sleep(0.1)
    if pidfile.exists():
        try:
            os.kill(int(pidfile.read_text()), signal.SIGKILL)
        except ProcessLookupError:
            pass
        pidfile.unlink(missing_ok=True)
    return False
