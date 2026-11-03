"""Exercise diagnostic subprocess failures, retention and secret filtering."""

import json
import os
from pathlib import Path
import re
import selectors
import signal
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from diagnostics_io import BoundedLog, Redactor, capture, terminate


class DiagnosticIOTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def log(self, name='sample', max_bytes=65536):
        return BoundedLog(self.directory, name, Redactor({}), max_bytes=max_bytes)

    def contents(self, name='sample'):
        return ''.join(path.read_text() for path in sorted(self.directory.glob(f'{name}.log*')))

    def capture_after_ready_deadline(self, command, log, stop=None):
        """Resume past the deadline only after the real pipe has readable output."""
        ready = threading.Event()
        test = self

        class ReadySelector(selectors.DefaultSelector):
            def register(self, fileobj, events, data=None):
                key = super().register(fileobj, events, data)
                test.assertTrue(self.select(5), 'child did not produce output')
                ready.set()
                if stop is not None:
                    stop.set()
                return key

        clock = SimpleNamespace(monotonic=lambda: 2 if ready.is_set() else 0)
        with patch('diagnostics_io.selectors.DefaultSelector', ReadySelector), \
                patch('diagnostics_io.time', clock):
            return capture(command, log, timeout=1, stop=stop)

    def test_ready_output_survives_deadline_before_first_read(self):
        code = self.capture_after_ready_deadline(
            ['/bin/sh', '-c', 'echo "offline probe"; sleep 30'], self.log())
        self.assertEqual(code, 124)
        self.assertIn('offline probe', self.contents())
        self.assertIn('collector timeout after 1s', self.contents())
        self.assertIn('collector exited with status 124', self.contents())

    def test_stop_recovers_ready_output_without_changing_stop_status(self):
        code = self.capture_after_ready_deadline(
            ['/bin/sh', '-c', 'echo "last stream message"; sleep 30'],
            self.log(), stop=threading.Event())
        self.assertEqual(code, 0)
        self.assertIn('last stream message', self.contents())
        self.assertNotIn('collector timeout', self.contents())

    def test_timeout_recovers_partial_stdout_and_stderr_with_redaction(self):
        for descriptor in [1, 2]:
            with self.subTest(descriptor=descriptor):
                name = f'partial-{descriptor}'
                log = BoundedLog(self.directory, name,
                                 Redactor({'TEST_TOKEN': 'split-secret-value'}))
                command = [sys.executable, '-c',
                           f'import os,time; os.write({descriptor}, '
                           'b"offline probe split-secret-value token=unknown-secret"); time.sleep(30)']
                real_read = os.read
                # Split credentials across recovery reads, without changing pipe readiness.
                with patch('diagnostics_io.os.read', side_effect=lambda fd, size: real_read(fd, min(size, 8))):
                    code = self.capture_after_ready_deadline(command, log)
                self.assertEqual(code, 124)
                output = self.contents(name)
                self.assertIn('offline probe', output)
                self.assertIn('[REDACTED]', output)
                self.assertNotIn('split-secret-value', output)
                self.assertNotIn('unknown-secret', output)

    def test_escaped_descendant_cannot_hold_shutdown_pipe_open(self):
        pidfile = self.directory / 'escaped.pid'
        command = [sys.executable, '-c', r'''import os, pathlib, sys, time
if os.fork() == 0:
    os.setsid()
    pathlib.Path(sys.argv[1]).write_text(str(os.getpid()))
    os.write(1, b'offline probe from descendant\n')
    time.sleep(30)
    os._exit(0)
time.sleep(30)
''', str(pidfile)]
        results = []
        worker = threading.Thread(target=lambda: results.append(
            self.capture_after_ready_deadline(command, self.log())))
        worker.start()
        worker.join(timeout=5)
        finished = not worker.is_alive()
        try:
            self.assertTrue(pidfile.exists(), 'escaped descendant did not start')
            pid = int(pidfile.read_text())
            os.kill(pid, 0)
        finally:
            if pidfile.exists():
                try:
                    os.kill(int(pidfile.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass
            worker.join(timeout=5)
        self.assertTrue(finished, 'capture waited for EOF from an escaped descendant')
        self.assertEqual(results, [124])
        self.assertIn('offline probe from descendant', self.contents())

    def capture_with_shutdown_reads(self, read):
        """Keep a real ready pipe; control only reads after its group is killed."""
        terminated = threading.Event()
        real_read = os.read

        def terminate_and_enable(process):
            terminate(process)
            terminated.set()

        def read_after_termination(fd, size):
            return read(size) if terminated.is_set() else real_read(fd, size)

        with patch('diagnostics_io.terminate', side_effect=terminate_and_enable), \
                patch('diagnostics_io.os.read', side_effect=read_after_termination):
            return self.capture_after_ready_deadline(
                ['/bin/sh', '-c', 'echo "ready"; sleep 30'], self.log(max_bytes=2048))

    def test_shutdown_recovery_discards_entire_oversized_line_and_keeps_next_line(self):
        chunks = iter([b'x' * 20000 + b'token=private-prefix',
                       b'-private-suffix\nsafe after long line\n', b''])
        self.assertEqual(self.capture_with_shutdown_reads(lambda _: next(chunks)), 124)
        output = self.contents()
        self.assertIn('oversized unterminated log line omitted', output)
        self.assertIn('safe after long line', output)
        self.assertNotIn('private-prefix', output)
        self.assertNotIn('private-suffix', output)
        self.assertLessEqual(sum(path.stat().st_size for path in self.directory.glob('sample.log*')), 2048)

    def test_shutdown_recovery_has_a_budget_even_if_a_descendant_keeps_writing(self):
        recovered_bytes = 0

        def endless_read(size):
            nonlocal recovered_bytes
            recovered_bytes += size
            # Bound a broken implementation's test runtime as well.
            self.assertLessEqual(recovered_bytes, 2 * 1024 * 1024,
                                 'shutdown recovery kept reading from a continuous writer')
            return b'x' * size

        self.assertEqual(self.capture_with_shutdown_reads(endless_read), 124)
        self.assertLessEqual(recovered_bytes, 1024 * 1024)

    def test_timeout_and_native_status_survive_log_write_failure(self):
        log = self.log()
        with patch.object(log, 'write', side_effect=OSError('disk full')), \
                patch('diagnostics_io.sys.stderr'):
            self.assertEqual(self.capture_after_ready_deadline(
                ['/bin/sh', '-c', 'echo "offline probe"; sleep 30'], log), 124)
            self.assertEqual(capture([sys.executable, '-c', 'print("error"); exit(23)'], log), 23)

    def test_known_secrets_and_nested_account_values_are_removed(self):
        redactor = Redactor({
            'TESTING_API_TOKEN': 'a-test-secret-token',
            'VISUAL_PASSWORD': 'a-test-password',
            'CLRN_CI_TEST_ACCOUNTS': json.dumps({'one': {
                'username': 'private-account-name', 'password': 'private-account-password'}}),
        })
        message = ' '.join(['a-test-secret-token', 'a-test-password',
                            'private-account-name', 'private-account-password'])
        output = redactor.redact(message)
        for value in message.split():
            self.assertNotIn(value, output)

    def test_unknown_credentials_and_sensitive_input_payloads_are_removed(self):
        redactor = Redactor({})
        for message, secret in [
            ('Authorization: Bearer unknown-bearer-secret', 'unknown-bearer-secret'),
            ('{"authorization": "Basic dGVzdDpzZWNyZXQ="}', 'dGVzdDpzZWNyZXQ='),
            ("{'proxy-authorization': 'Basic another-secret'}", 'another-secret'),
            ('{"password": "unknown-json-secret"}', 'unknown-json-secret'),
            ('https://example.test/?access_token=unknown-query-secret&safe=1', 'unknown-query-secret'),
            ('adb shell input text typed-private-value', 'typed-private-value'),
        ]:
            with self.subTest(message=message):
                self.assertNotIn(secret, redactor.redact(message))
        self.assertIn('device offline', redactor.redact('device offline'))

    def test_log_entries_have_utc_timestamps(self):
        self.log().write('first line\nsecond line\n')
        lines = self.contents().splitlines()
        self.assertGreaterEqual(len(lines), 2)
        for line in lines:
            self.assertRegex(line, r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*(?:Z|\+00:00)')

    def test_rotation_caps_total_bytes_and_retains_recent_utf8(self):
        log = self.log(max_bytes=2048)
        for index in range(60):
            log.write(f'entry {index} ' + '设备日志' * 30)
        log.write('newest marker')
        paths = list(self.directory.glob('sample.log*'))
        self.assertLessEqual(sum(path.stat().st_size for path in paths), 2048)
        self.assertIn('newest marker', self.contents())
        self.assertNotIn('entry 0 ', self.contents())

    def test_single_huge_line_cannot_exceed_capacity_or_leak_secret(self):
        log = BoundedLog(self.directory, 'sample', Redactor({'VISUAL_PASSWORD': 'split-secret-value'}),
                         max_bytes=2048)
        log.write('x' * 100000 + 'split-secret-value' + 'y' * 100000)
        self.assertLessEqual(sum(path.stat().st_size for path in self.directory.glob('sample.log*')), 2048)
        self.assertNotIn('split-secret-value', self.contents())

    def test_nonzero_command_preserves_output_and_exit_code(self):
        code = capture([sys.executable, '-c',
                        'import sys; print("original test error", flush=True); sys.exit(23)'], self.log())
        self.assertEqual(code, 23)
        self.assertIn('original test error', self.contents())

    def test_timeout_preserves_early_output_and_other_collector_can_run(self):
        started = time.monotonic()
        code = capture(['/bin/sh', '-c', 'echo "before disconnect"; sleep 30'],
                       self.log(), timeout=0.2)
        self.assertEqual(code, 124)
        self.assertLess(time.monotonic() - started, 5)
        self.assertIn('before disconnect', self.contents())
        self.assertRegex(self.contents().lower(), r'time.?out')
        self.assertEqual(capture([sys.executable, '-c', 'print("host remains available")'],
                                 self.log('host'), timeout=1), 0)
        self.assertIn('host remains available', self.contents('host'))

    def test_missing_command_records_failure_without_raising(self):
        code = capture([str(self.directory / 'missing-adb')], self.log(), timeout=0.2)
        self.assertEqual(code, 127)
        self.assertTrue(re.search(r'error|failed|no such file', self.contents(), re.I))

    def test_stopping_stream_also_stops_child_that_closed_stdout(self):
        stop = threading.Event()
        result = []
        worker = threading.Thread(target=lambda: result.append(capture([
            sys.executable, '-c',
            'import os,time; os.close(1); os.close(2); time.sleep(3)',
        ], self.log(), timeout=None, stop=stop)))
        worker.start()
        time.sleep(0.2)
        stop.set()
        worker.join(timeout=1)
        stopped = not worker.is_alive()
        worker.join(timeout=4)
        self.assertTrue(stopped, 'stream shutdown blocked on a child with closed output')
        self.assertEqual(result, [0])


if __name__ == '__main__':
    unittest.main()
