"""Bounded, timestamped, redacted diagnostics without third-party dependencies."""

import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
from urllib.parse import quote

from diagnostics_lifecycle import finish_group, group_members


class Redactor:
    """Mask configured credentials and sensitive fields before they reach disk."""

    def __init__(self, env=None):
        values = set()

        def collect(value):
            if isinstance(value, dict):
                for child in value.values():
                    collect(child)
            elif isinstance(value, list):
                for child in value:
                    collect(child)
            elif isinstance(value, str) and value:
                values.update((value, quote(value, safe=''), json.dumps(value)[1:-1]))

        for key, value in (os.environ if env is None else env).items():
            if re.search(r'PASSWORD|TOKEN|SECRET|CREDENTIAL|USERNAME|ACCOUNTS|API_KEY', key, re.I):
                collect(value)
                try:
                    collect(json.loads(value))
                except (ValueError, TypeError):
                    pass
        self.values = sorted(values, key=len, reverse=True)

    def redact(self, text):
        for value in self.values:
            text = text.replace(value, '[REDACTED]')
        text = re.sub(r'(?i)(\b(?:input\s+(?:text|keyevent)|InputConnection|commitText|setText)\b).*',
                      r'\1 [REDACTED]', text)
        text = re.sub(r'''(?i)(\b(?:authorization|proxy-authorization)["']?\s*[:=]\s*).*''',
                      r'\1[REDACTED]', text)
        text = re.sub(r'(?i)\bBearer\s+[^\s"\']+', 'Bearer [REDACTED]', text)
        text = re.sub(r'(?i)(["\']?(?:password|passwd|token|access_token|refresh_token|api_key|secret|cookie|username|login|phone)["\']?\s*[:=]\s*)("[^"\n]*"|\x27[^\x27\n]*\x27|[^\s&,;}]+)',
                      r'\1[REDACTED]', text)
        return re.sub(r'(https?://)[^/@\s]+:[^/@\s]+@', r'\1[REDACTED]@', text)


class BoundedLog:
    """Keep two generations totaling at most max_bytes, with a lock per stream."""

    def __init__(self, directory, name, redactor, max_bytes=2 * 1024 * 1024):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / f'{name}.log'
        self.previous = self.directory / f'{name}.log.1'
        self.lock = self.directory / f'.{name}.lock'
        self.limit = max_bytes // 2
        if self.limit < 128:
            raise ValueError('Log capacity must be at least 256 bytes')
        self.redactor = redactor

    def write(self, text):
        for line in str(text).splitlines():
            timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds')
            payload = f'{timestamp} {self.redactor.redact(line)}\n'.encode('utf-8')
            if len(payload) > self.limit:
                payload = f'{timestamp} [oversized log line omitted]\n'.encode('utf-8')
            with self.lock.open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                if self.path.exists() and self.path.stat().st_size + len(payload) > self.limit:
                    self.path.replace(self.previous)
                with self.path.open('ab') as output:
                    output.write(payload)


def terminate(process):
    """Kill a collector process group, including hung descendants."""
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=2)


def describe_group(process, report):
    try:
        report(f'pgid={process.pid}\n' + '\n'.join(group_members(process.pid)))
    except (OSError, subprocess.SubprocessError):
        report(f'pgid={process.pid} process snapshot unavailable')


class _CaptureOutput:
    """Share line framing between live reads and bounded shutdown recovery."""

    def __init__(self, stream, report):
        self.stream = stream
        self.report = report
        self.pending = b''
        self.discard = False
        os.set_blocking(stream.fileno(), False)

    def read(self):
        try:
            return os.read(self.stream.fileno(), 65536)
        except BlockingIOError:
            return None

    def consume(self, chunk):
        self.pending += chunk
        while b'\n' in self.pending:
            line, self.pending = self.pending.split(b'\n', 1)
            if not self.discard:
                self.report(line.decode('utf-8', errors='replace'))
            self.discard = False
        if len(self.pending) > 16384:
            self.report('[oversized unterminated log line omitted]')
            self.pending = b''
            self.discard = True

    def drain(self):
        # Recover queued output after killing the group. Never wait for EOF:
        # an escaped descendant may still own the pipe or keep writing to it.
        # At most 1 MiB is read, with the same bounded line buffer as live reads.
        for _ in range(16):
            chunk = self.read()
            if not chunk:
                break
            self.consume(chunk)

    def finish(self):
        if self.pending and not self.discard:
            self.report(self.pending.decode('utf-8', errors='replace'))


def _interrupted_status(process, deadline, timeout, stop, report, stop_status=0):
    if stop is not None and stop.is_set():
        report(f'phase=stop-requested pgid={process.pid}')
        describe_group(process, report)
        terminate(process)
        return stop_status
    if deadline is not None and time.monotonic() >= deadline:
        report(f'collector timeout after {timeout}s')
        describe_group(process, report)
        terminate(process)
        return 124
    return None


def _wait_for_exit(process, deadline, timeout, stop, report, stop_status):
    # A child can close stdout while remaining alive: still enforce timeout/stop.
    while True:
        status = _interrupted_status(process, deadline, timeout, stop, report, stop_status)
        if status is not None:
            return status
        try:
            return process.wait(timeout=0.1)
        except subprocess.TimeoutExpired:
            pass


def _collect_output(process, output, deadline, timeout, stop, report, exit_timeout, stop_status):
    exited_at = None
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while selector.get_map():
            status = _interrupted_status(process, deadline, timeout, stop, report, stop_status)
            if status is not None:
                output.drain()
                return status
            if process.poll() is not None:
                if exited_at is None:
                    exited_at = time.monotonic()
                if time.monotonic() - exited_at >= exit_timeout:
                    report(f'phase=output-drain timeout after {exit_timeout}s pgid={process.pid}')
                    describe_group(process, report)
                    terminate(process)
                    output.drain()
                    return 124
            for key, _ in selector.select(0.1):
                chunk = output.read()
                if chunk == b'':
                    selector.unregister(key.fileobj)
                elif chunk is not None:
                    output.consume(chunk)
    return _wait_for_exit(process, deadline, timeout, stop, report, stop_status)


def _finish_capture_group(process, status, report):
    if status == 124:
        return status
    try:
        if not finish_group(process, report):
            return status or 124
    except (OSError, subprocess.SubprocessError):
        report(f'phase=process-cleanup failed pgid={process.pid}; killing group')
        terminate(process)
        return 124
    return status


def _register_capture(process, log, report):
    directory = getattr(log, 'directory', None)
    if directory is None:
        return None
    pidfile = directory / f'diagnostic-process-{process.pid}.pid'
    try:
        pidfile.write_text(str(process.pid))
    except OSError:
        report('diagnostic process registration unavailable')
    return pidfile


def capture(command, log, timeout=5, stop=None, env=None, exit_timeout=2, stop_status=0, pidfile=None):
    """Stream output with bounded memory; return the native exit or 124/127."""
    def report(message):
        try:
            log.write(message)
        except OSError as error:
            print(f'Android diagnostic log write failed ({type(error).__name__}).', file=sys.stderr)

    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   start_new_session=True, env=env)
    except OSError as error:
        report(f'collector spawn failed: {type(error).__name__}: {error}')
        return 127
    deadline = time.monotonic() + timeout if timeout is not None else None
    registration = _register_capture(process, log, report)
    try:
        if pidfile is not None:
            pidfile.write_text(str(process.pid))
        output = _CaptureOutput(process.stdout, report)
        status = _collect_output(process, output, deadline, timeout, stop, report, exit_timeout, stop_status)
        status = _finish_capture_group(process, status, report)
        output.finish()
        if status:
            report(f'collector exited with status {status}')
        return status
    finally:
        process.stdout.close()
        if process.poll() is None:
            terminate(process)
        if pidfile is not None:
            pidfile.unlink(missing_ok=True)
        if registration is not None:
            registration.unlink(missing_ok=True)
