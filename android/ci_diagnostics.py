"""Lifecycle CLI for independent Android CI diagnostics collectors."""

import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

from diagnostics_io import BoundedLog, Redactor, capture


ROOT = Path(__file__).resolve().parent
DEFAULT_DIRECTORY = ROOT / 'artifacts' / 'diagnostics'


def directory():
    return Path(os.environ.get('ANDROID_DIAGNOSTICS_DIR', DEFAULT_DIRECTORY)).resolve()


def adb_executable():
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    path = Path(sdk) / 'platform-tools' / 'adb' if sdk else Path(shutil.which('adb') or 'adb')
    original = path.with_name(path.name + '.diagnostics-original')
    return str(original if original.exists() else path)


def stream(command, log, stop_event, retry_delay=1):
    """Reconnect a continuous stream without discarding output captured earlier."""
    while not stop_event.is_set():
        status = capture(command, log, timeout=None, stop=stop_event)
        if not stop_event.is_set():
            log.write(f'stream disconnected status={status}; reconnecting')
            stop_event.wait(retry_delay)


class Collector:
    """Probe host/device independently so an unavailable device cannot block host data."""

    def __init__(self, directory, interval=10, timeout=5):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.interval = interval
        self.timeout = timeout
        self.redactor = Redactor()
        self.logs = {name: BoundedLog(self.directory, name, self.redactor)
                     for name in ['lifecycle', 'adb', 'logcat', 'host', 'emulator', 'adb-server', 'cleanup']}
        self.adb = adb_executable()
        self.serial = os.environ.get('ANDROID_SERIAL', 'emulator-5554')
        self.stop_event = threading.Event()

    def sample(self, phase='periodic'):
        self.logs['lifecycle'].write(f'phase={phase}')
        commands = {
            'devices': ('adb', [self.adb, 'devices', '-l']),
            'state': ('adb', [self.adb, '-s', self.serial, 'get-state']),
            'device-processes': ('adb', [self.adb, '-s', self.serial, 'shell', 'ps', '-A']),
            'host-processes': ('host', ['ps', '-eo', 'pid,ppid,stat,pcpu,pmem,comm']),
            'memory': ('host', ['free', '-m']),
            'disk': ('host', ['df', '-h']),
            'load': ('host', ['uptime']),
        }
        results = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(commands)) as pool:
            tasks = {pool.submit(capture, command, self.logs[name], self.timeout): label
                     for label, (name, command) in commands.items()}
            for task in concurrent.futures.as_completed(tasks):
                label = tasks[task]
                try:
                    results[label] = task.result()
                except Exception as error:
                    results[label] = 1
                    self.logs['lifecycle'].write(f'{label}: collector failed: {type(error).__name__}: {error}')
        self.logs['lifecycle'].write(f'collection_results={json.dumps(results, sort_keys=True)}')
        return results

    def follow_server(self):
        """Tail the existing ADB daemon log; never enable payload/packet tracing."""
        path = Path(tempfile.gettempdir()) / f'adb.{os.getuid()}.log'
        offset = 0
        identity = None
        pending = b''
        missing_reported = False
        while not self.stop_event.is_set():
            try:
                stat = path.stat()
                if identity != stat.st_ino or stat.st_size < offset:
                    identity, offset, pending = stat.st_ino, max(0, stat.st_size - 65536), b''
                with path.open('rb') as source:
                    source.seek(offset)
                    data = source.read(65536)
                    offset = source.tell()
                pending += data
                lines = pending.split(b'\n')
                pending = lines.pop()
                for line in lines:
                    self.logs['adb-server'].write(line.decode('utf-8', errors='replace'))
                if len(pending) > 16384:
                    pending = b''
                    self.logs['adb-server'].write('[oversized daemon log line omitted]')
                missing_reported = False
            except OSError as error:
                if not missing_reported:
                    self.logs['adb-server'].write(f'daemon log unavailable: {error}')
                    missing_reported = True
            self.stop_event.wait(0.5)

    def serve(self):
        signal.signal(signal.SIGTERM, lambda *_: self.stop_event.set())
        signal.signal(signal.SIGINT, lambda *_: self.stop_event.set())
        threads = [threading.Thread(target=stream, args=(
            [self.adb, '-s', self.serial, 'logcat', '-v', 'epoch', '-T', '1'],
            self.logs['logcat'], self.stop_event), daemon=True),
            threading.Thread(target=self.follow_server, daemon=True)]
        for thread in threads:
            thread.start()
        self.logs['lifecycle'].write('collector started')
        (self.directory / 'ready').touch()
        try:
            while not self.stop_event.is_set():
                self.sample()
                self.stop_event.wait(self.interval)
        finally:
            self.stop_event.set()
            for thread in threads:
                thread.join(timeout=self.timeout + 2)
            self.logs['lifecycle'].write('collector stopped')
            (self.directory / 'ready').unlink(missing_ok=True)


def collector():
    return Collector(directory(), interval=float(os.environ.get('ANDROID_DIAGNOSTICS_INTERVAL', '10')),
                     timeout=float(os.environ.get('ANDROID_DIAGNOSTICS_TIMEOUT', '5')))


def start():
    diagnostics = collector()
    pidfile = directory() / 'collector.pid'
    if pidfile.exists():
        raise RuntimeError('Collector already started; stop before starting another')
    metadata = {key: os.environ.get(key, '') for key in [
        'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_SHA',
        'ANDROID_GROUP', 'ANDROID_LOCALE', 'ANDROID_DIAGNOSTICS_SHARD', 'ANDROID_SERIAL']}
    diagnostics.logs['lifecycle'].write(f'run={json.dumps(metadata, sort_keys=True)}')
    child = subprocess.Popen([sys.executable, str(ROOT / 'ci_diagnostics.py'), 'serve'],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
    pidfile.write_text(str(child.pid))
    for _ in range(50):
        if (directory() / 'ready').exists():
            return 0
        if child.poll() is not None:
            raise RuntimeError(f'Collector startup failed with status {child.returncode}')
        time.sleep(0.1)
    raise RuntimeError('Collector startup timed out')


def stop():
    diagnostics = collector()
    diagnostics.sample('after-emulator-action')
    pidfile = directory() / 'collector.pid'
    if pidfile.exists():
        pid = int(pidfile.read_text())
        try:
            os.kill(pid, signal.SIGTERM)
            for _ in range(100):
                if not (directory() / 'ready').exists():
                    break
                time.sleep(0.1)
            else:
                os.killpg(pid, signal.SIGKILL)
                diagnostics.logs['lifecycle'].write('collector shutdown timed out; killed process group')
        except ProcessLookupError:
            diagnostics.logs['lifecycle'].write('collector already exited')
        pidfile.unlink(missing_ok=True)
    from diagnostics_wrappers import restore
    restore()
    return 0


def best_effort(action, log=None):
    """Diagnostics errors are visible but must not replace the test's result."""
    try:
        return action()
    except Exception as error:
        print(f'Android diagnostics failed ({type(error).__name__}); continuing.', file=sys.stderr)
        if log is not None:
            try:
                log.write(f'collection failed: {type(error).__name__}: {error}')
            except Exception:
                pass
        return None


def run(command):
    diagnostics = best_effort(collector)
    if diagnostics:
        best_effort(lambda: diagnostics.logs['lifecycle'].write('phase=test-start'))
    status = 127
    try:
        result = subprocess.run(command, check=False)
        status = result.returncode if result.returncode >= 0 else 128 - result.returncode
    except OSError as error:
        print(f'Android test spawn failed ({type(error).__name__}).', file=sys.stderr)
        if diagnostics:
            best_effort(lambda failure=error: diagnostics.logs['lifecycle'].write(f'test spawn failed: {failure}'))
    finally:
        if diagnostics:
            best_effort(lambda: diagnostics.logs['lifecycle'].write(f'test_exit={status}'))
            best_effort(lambda: diagnostics.sample('after-test'), diagnostics.logs['lifecycle'])
    return status


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ''
    if action == 'serve':
        collector().serve()
        return 0
    if action == 'start':
        best_effort(start)
        return 0
    if action == 'stop':
        best_effort(stop)
        return 0
    if action == 'snapshot':
        best_effort(lambda: collector().sample('manual'))
        return 0
    if action == 'install-emulator-wrapper':
        from diagnostics_wrappers import install
        best_effort(install)
        return 0
    if action == 'run' and len(sys.argv) > 3 and sys.argv[2] == '--':
        return run(sys.argv[3:])
    raise SystemExit('usage: ci_diagnostics.py start|stop|snapshot|install-emulator-wrapper|run -- COMMAND')


if __name__ == '__main__':
    sys.exit(main())
