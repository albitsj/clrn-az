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
    process.wait()


def capture(command, log, timeout=5, stop=None, env=None):
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
    pending = b''
    discard = False
    status = None
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                if stop is not None and stop.is_set():
                    terminate(process)
                    status = 0
                    break
                if deadline is not None and time.monotonic() >= deadline:
                    report(f'collector timeout after {timeout}s')
                    terminate(process)
                    status = 124
                    break
                for key, _ in selector.select(0.1):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        break
                    pending += chunk
                    while b'\n' in pending:
                        line, pending = pending.split(b'\n', 1)
                        if not discard:
                            report(line.decode('utf-8', errors='replace'))
                        discard = False
                    if len(pending) > 16384:
                        report('[oversized unterminated log line omitted]')
                        pending = b''
                        discard = True
            if pending and not discard:
                report(pending.decode('utf-8', errors='replace'))
        if status is None:
            # A child can close stdout while remaining alive: still enforce timeout.
            while status is None:
                if stop is not None and stop.is_set():
                    terminate(process)
                    status = 0
                elif deadline is not None and time.monotonic() >= deadline:
                    report(f'collector timeout after {timeout}s')
                    terminate(process)
                    status = 124
                else:
                    try:
                        status = process.wait(timeout=0.1)
                    except subprocess.TimeoutExpired:
                        pass
        if status:
            report(f'collector exited with status {status}')
        return status
    finally:
        process.stdout.close()
        if process.poll() is None:
            terminate(process)
