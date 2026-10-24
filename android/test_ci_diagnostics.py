"""Regression coverage for lifecycle failures and reconnecting subprocess streams."""

from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from ci_diagnostics import Collector, run, stream
from diagnostics_io import BoundedLog, Redactor, capture


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def contents(self, name):
        return ''.join(path.read_text() for path in sorted(self.directory.glob(f'{name}.log*')))

    def capture_with_portable_host(self, command, log, timeout):
        if 'adb' in Path(command[0]).name:
            return capture(command, log, timeout)
        return capture([sys.executable, '-c', 'print("host resources available")'], log, timeout=5)

    def test_disconnected_stream_reconnects_and_retains_both_sides(self):
        counter = self.directory / 'connection-count'
        script = self.directory / 'device.py'
        script.write_text('''import pathlib, sys, time
counter = pathlib.Path(sys.argv[1])
attempt = int(counter.read_text()) + 1 if counter.exists() else 1
counter.write_text(str(attempt))
if attempt == 1:
    print('before-disconnect', flush=True)
    print('error: device offline', flush=True)
    sys.exit(1)
print('after-reconnect', flush=True)
time.sleep(10)
''')
        stop = threading.Event()
        log = BoundedLog(self.directory, 'logcat', Redactor({}))
        worker = threading.Thread(target=stream, args=(
            [sys.executable, str(script), str(counter)], log, stop, 0.05))
        worker.start()
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and 'after-reconnect' not in self.contents('logcat'):
                time.sleep(0.02)
        finally:
            stop.set()
            worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(counter.read_text(), '2')
        output = self.contents('logcat')
        self.assertIn('before-disconnect', output)
        self.assertIn('device offline', output)
        self.assertIn('after-reconnect', output)
        self.assertIn('reconnecting', output)

    def test_hung_adb_probes_do_not_block_host_collectors(self):
        adb = self.directory / 'adb'
        adb.write_text(f'#!{sys.executable}\nimport time\nprint("offline probe", flush=True)\ntime.sleep(30)\n')
        adb.chmod(0o755)
        collector = Collector(self.directory, timeout=1)
        collector.adb = str(adb)
        started = time.monotonic()
        with patch('ci_diagnostics.capture', side_effect=self.capture_with_portable_host):
            results = collector.sample('initialization')
        self.assertLess(time.monotonic() - started, 10)
        for name in ['devices', 'state', 'device-processes']:
            self.assertEqual(results[name], 124)
        for name in ['host-processes', 'disk', 'load']:
            self.assertEqual(results[name], 0)
        self.assertIn('offline probe', self.contents('adb'))
        self.assertIn('phase=initialization', self.contents('lifecycle'))
        self.assertTrue(self.contents('host'))

    def test_missing_adb_preserves_independent_host_and_failure_diagnostics(self):
        collector = Collector(self.directory, timeout=1)
        collector.adb = str(self.directory / 'missing-adb')
        with patch('ci_diagnostics.capture', side_effect=self.capture_with_portable_host):
            results = collector.sample('initialization')
        self.assertEqual(results['devices'], 127)
        self.assertEqual(results['host-processes'], 0)
        self.assertIn('spawn failed', self.contents('adb'))
        self.assertTrue(self.contents('host'))

    def test_final_collection_failure_does_not_replace_test_exit(self):
        collector = Collector(self.directory)
        with patch('ci_diagnostics.collector', return_value=collector), \
                patch.object(collector, 'sample', side_effect=RuntimeError('cleanup unavailable')):
            self.assertEqual(run([sys.executable, '-c', 'raise SystemExit(23)']), 23)
        self.assertIn('test_exit=23', self.contents('lifecycle'))
        self.assertIn('cleanup unavailable', self.contents('lifecycle'))

    def test_collector_initialization_failure_does_not_prevent_test_or_replace_exit(self):
        marker = self.directory / 'test-ran'
        command = [sys.executable, '-c',
                   'import pathlib,sys; pathlib.Path(sys.argv[1]).touch(); raise SystemExit(23)', str(marker)]
        with patch('ci_diagnostics.collector', side_effect=OSError('diagnostics directory unavailable')):
            self.assertEqual(run(command), 23)
        self.assertTrue(marker.exists())

    def test_missing_test_command_is_recorded_as_spawn_failure(self):
        collector = Collector(self.directory)
        with patch('ci_diagnostics.collector', return_value=collector), \
                patch.object(collector, 'sample', return_value={}):
            self.assertEqual(run([str(self.directory / 'missing-test')]), 127)
        self.assertIn('test spawn failed', self.contents('lifecycle'))
        self.assertIn('test_exit=127', self.contents('lifecycle'))

    def test_logging_failure_does_not_replace_successful_or_failed_test(self):
        collector = Collector(self.directory)
        with patch('ci_diagnostics.collector', return_value=collector), \
                patch.object(collector.logs['lifecycle'], 'write', side_effect=OSError('disk full')), \
                patch.object(collector, 'sample', side_effect=OSError('disk full')):
            for status in [0, 23]:
                with self.subTest(status=status):
                    self.assertEqual(run([sys.executable, '-c', f'raise SystemExit({status})']), status)


if __name__ == '__main__':
    unittest.main()
