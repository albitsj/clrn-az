"""Smoke must retain observed redacted markers before its bounded log rotates."""

import json
import os
from pathlib import Path
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
