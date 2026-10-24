"""Exercise diagnostic subprocess failures, retention and secret filtering."""

import json
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
import unittest

from diagnostics_io import BoundedLog, Redactor, capture


class DiagnosticIOTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def log(self, name='sample', max_bytes=65536):
        return BoundedLog(self.directory, name, Redactor({}), max_bytes=max_bytes)

    def contents(self, name='sample'):
        return ''.join(path.read_text() for path in sorted(self.directory.glob(f'{name}.log*')))

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
        code = capture([sys.executable, '-c',
                        'import time; print("before disconnect", flush=True); time.sleep(30)'],
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
