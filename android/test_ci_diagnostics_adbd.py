"""A closed root handshake needs verified privilege and both original markers."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import call, patch

import ci_diagnostics_smoke as smoke


class DiagnosticsTestCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.addCleanup(patch.stopall)
        patch.object(smoke, 'DIRECTORY', Path(temporary.name)).start()
        patch.dict(os.environ, {'DIAGNOSTICS_SMOKE_TOKEN': 'public-test-sentinel'}).start()


class RootRestartTests(DiagnosticsTestCase):
    def setUp(self):
        super().setUp()
        (smoke.DIRECTORY / 'emulator-process.pid').write_text('12345')
        self.root_status = 1
        self.root_output = b'adb: unable to connect for root: closed\n'
        self.uid = b'0\n'
        self.wait_error = None
        self.calls = []
        self.marker = patch.object(smoke, 'marker').start()
        patch.object(smoke, 'contents', return_value=(
            'CI_DIAG_BEFORE_RECONNECT test_exit=0 test_exit=23')).start()
        patch.object(smoke, 'diagnose_root_failure').start()
        patch.object(smoke.subprocess, 'run', side_effect=self.run_command).start()

    def run_command(self, arguments, **_kwargs):
        self.calls.append(arguments)
        status, output = 0, b''
        if arguments == [*smoke.ADB, 'root']:
            status, output = self.root_status, self.root_output
        elif arguments == [*smoke.ADB, 'wait-for-device'] and self.wait_error:
            raise self.wait_error
        elif arguments == [*smoke.ADB, 'shell', 'id', '-u']:
            output = self.uid
        elif arguments[:len(smoke.CLI)] == smoke.CLI and '23' in arguments[-1]:
            status = 23
        return subprocess.CompletedProcess(arguments, status, output)

    def assert_single_root(self):
        self.assertEqual(self.calls.count([*smoke.ADB, 'root']), 1)

    def test_closed_handshake_with_verified_root_keeps_both_markers(self):
        smoke.exercise('normal')
        self.assert_single_root()
        self.assertIn([*smoke.ADB, 'wait-for-device'], self.calls)
        self.assertIn([*smoke.ADB, 'shell', 'id', '-u'], self.calls)
        self.assertEqual(self.marker.call_args_list, [call('CI_DIAG_BEFORE_RECONNECT'),
                                                     call('CI_DIAG_AFTER_RECONNECT')])

    def test_closed_handshake_without_root_retains_original_failure(self):
        self.uid = b'2000\n'
        with self.assertRaisesRegex(AssertionError, 'Command returned 1; expected 0'):
            smoke.exercise('normal')
        self.assert_single_root()
        self.assertEqual(self.marker.call_args_list, [call('CI_DIAG_BEFORE_RECONNECT')])

    def test_unexpected_error_or_status_never_becomes_verified_success(self):
        for status, output in [(1, b'adbd cannot run as root in production builds\n'),
                               (13, self.root_output), (1, b'device offline\n')]:
            with self.subTest(status=status, output=output):
                self.calls.clear()
                self.marker.reset_mock()
                self.root_status, self.root_output = status, output
                with self.assertRaises(AssertionError):
                    smoke.exercise('normal')
                self.assert_single_root()
                self.assertNotIn([*smoke.ADB, 'wait-for-device'], self.calls)
                self.assertEqual(self.marker.call_args_list, [call('CI_DIAG_BEFORE_RECONNECT')])

    def test_closed_handshake_reconnect_timeout_keeps_original_and_cause(self):
        self.wait_error = subprocess.TimeoutExpired('adb', 120)
        with self.assertRaisesRegex(AssertionError, 'Command returned 1; expected 0') as raised:
            smoke.exercise('normal')
        self.assertIs(raised.exception.__cause__, self.wait_error)
        self.assert_single_root()
        self.assertEqual(self.marker.call_args_list, [call('CI_DIAG_BEFORE_RECONNECT')])

    def test_successful_handshake_still_requires_actual_root(self):
        self.root_status, self.root_output, self.uid = 0, b'restarting adbd as root\n', b'2000\n'
        with self.assertRaisesRegex(AssertionError, 'root verification'):
            smoke.exercise('normal')
        self.assert_single_root()

    def test_successful_handshake_and_actual_root_continue_once(self):
        self.root_status, self.root_output = 0, b'restarting adbd as root\n'
        smoke.exercise('normal')
        self.assert_single_root()
        self.assertIn([*smoke.ADB, 'shell', 'id', '-u'], self.calls)

    def test_diagnostic_failure_preserves_original_root_error(self):
        original = AssertionError('original root failure')
        def fail_root(arguments, **_kwargs):
            if arguments == [*smoke.ADB, 'root']:
                raise original
        with patch.object(smoke, 'command', side_effect=fail_root), \
                patch.object(smoke, 'diagnose_root_failure', side_effect=OSError('disk full')), \
                patch('sys.stderr'), self.assertRaises(AssertionError) as raised:
            smoke.exercise('normal')
        self.assertIs(raised.exception, original)


class RootDiagnosticTests(DiagnosticsTestCase):
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
