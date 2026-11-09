"""Smoke must retain observed redacted markers before its bounded log rotates."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ci_diagnostics_smoke as smoke
from diagnostics_io import BoundedLog, Redactor


class SmokeMarkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.addCleanup(patch.stopall)
        patch.object(smoke, 'DIRECTORY', self.directory).start()
        patch.dict(os.environ, {'DIAGNOSTICS_SMOKE_TOKEN': 'public-test-sentinel',
                                'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}).start()
        self.log = BoundedLog(self.directory, 'logcat', Redactor({}), max_bytes=512)

    def test_observed_redacted_marker_survives_real_log_rotation(self):
        self.log.write('CI_DIAG_LIFECYCLE_READY [REDACTED]')
        with patch.object(smoke, 'command'):
            smoke.marker('CI_DIAG_LIFECYCLE_READY')
        for _ in range(12):
            self.log.write('later Android output ' + 'x' * 120)
        self.assertNotIn('CI_DIAG_LIFECYCLE_READY', smoke.contents('logcat'))
        for name in ['lifecycle', 'adb', 'host', 'emulator', 'cleanup']:
            BoundedLog(self.directory, name, Redactor({})).write('diagnostics ready')
        BoundedLog(self.directory, 'lifecycle', Redactor({})).write(
            'before-emulator-shutdown\ntest_exit=23')
        BoundedLog(self.directory, 'cleanup', Redactor({})).write('cleanup_exit=0')
        BoundedLog(self.directory, 'emulator', Redactor({})).write(
            'phase=emulator-shutdown graceful-stop\nemulator_exit=0')
        with patch('ci_diagnostics_smoke_process.verify_processes'):
            smoke.verify('graceful-stop', 'success', 'success')
        receipt = json.loads((self.directory / 'smoke-validation.json').read_text())
        self.assertTrue(receipt['redaction_verified'])
        self.assertIn('CI_DIAG_LIFECYCLE_READY [REDACTED]', smoke.contents('smoke-markers'))

    def test_unredacted_marker_fails_before_checkpoint_can_mask_it(self):
        self.log.write('CI_DIAG_LIFECYCLE_READY public-test-sentinel')
        with patch.object(smoke, 'command'), self.assertRaises(AssertionError):
            smoke.marker('CI_DIAG_LIFECYCLE_READY')
        self.assertFalse((self.directory / 'smoke-markers.log').exists())

    def test_missing_marker_does_not_create_a_checkpoint(self):
        self.log.write('unrelated Android output [REDACTED]')
        with patch.object(smoke, 'command'), patch.object(smoke.time, 'sleep'), \
                patch.object(smoke.time, 'monotonic', side_effect=[0, 1, 31]), \
                self.assertRaisesRegex(AssertionError, 'did not retain'):
            smoke.marker('CI_DIAG_LIFECYCLE_READY')
        self.assertFalse((self.directory / 'smoke-markers.log').exists())

    def test_root_failure_keeps_original_error_even_when_diagnostics_fail(self):
        for error in [AssertionError('Command returned 1; expected 0'),
                      subprocess.TimeoutExpired('adb', 120)]:
            with self.subTest(error=type(error).__name__):
                def fail_root(arguments, **kwargs):
                    if arguments == [*smoke.ADB, 'root']:
                        raise error
                with patch.object(smoke, 'command', side_effect=fail_root) as command, \
                        patch.object(smoke, 'marker'), \
                        patch.object(smoke, 'diagnose_root_failure', side_effect=OSError('disk full')), \
                        patch('sys.stderr'), self.assertRaises(type(error)) as raised:
                    smoke.exercise('normal')
                self.assertIs(raised.exception, error)
                self.assertEqual(sum(call.args[0] == [*smoke.ADB, 'root']
                                     for call in command.call_args_list), 1)
                self.assertNotIn([*smoke.ADB, 'wait-for-device'],
                                 [call.args[0] for call in command.call_args_list])

    def test_root_diagnostics_are_bounded_redacted_and_continue_after_probe_timeout(self):
        results = [subprocess.TimeoutExpired('adb', 12),
                   subprocess.CompletedProcess([], 0, b'public-test-sentinel\nroot\n'),
                   subprocess.CompletedProcess([], 1, b'device offline\n')]
        with patch.object(smoke.subprocess, 'run', side_effect=results) as run, patch('sys.stderr'):
            smoke.diagnose_root_failure()
        self.assertEqual([call.kwargs['timeout'] for call in run.call_args_list], [12, 5, 5])
        self.assertFalse(any(call.args[0][-1] == 'root' for call in run.call_args_list))
        observed = smoke.contents('smoke-root-failure')
        self.assertNotIn('public-test-sentinel', observed)
        self.assertIn('[REDACTED]', observed)
        self.assertIn('phase=root-state', observed)
        self.assertIn('phase=daemon-log', observed)
        self.assertIn('exit=1', observed)
