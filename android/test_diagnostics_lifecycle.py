"""Run real process trees through shutdown, cancellation and pipe failures."""

import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from ci_diagnostics import Collector, run, stop, stop_daemon
from diagnostics_io import capture
from diagnostics_lifecycle import group_members, request_shutdown, wait_emulator
from diagnostics_wrappers import install_binaries, restore, shutdown


ROOT = Path(__file__).resolve().parent


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.diagnostics = Collector(self.directory)
        self.log = self.diagnostics.logs['cleanup']

    def wait_for(self, path, process=None):
        deadline = time.monotonic() + 5
        while not path.exists() and time.monotonic() < deadline:
            if process is not None and process.poll() is not None:
                self.fail(f'Fixture exited early: {process.returncode}')
            time.sleep(0.02)
        self.assertTrue(path.exists(), f'Fixture did not create {path.name}')

    def contents(self, name):
        return ''.join(path.read_text() for path in sorted(self.directory.glob(f'{name}.log*')))

    def test_parent_exit_cannot_wait_forever_for_inherited_output_pipe(self):
        pidfile = self.directory / 'child.pid'
        script = '''import os, pathlib, signal, sys, time
if os.fork() == 0:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    pathlib.Path(sys.argv[1]).write_text(str(os.getpid()))
    print('descendant retains pipe', flush=True)
    time.sleep(60)
else:
    time.sleep(0.2)
'''
        started = time.monotonic()
        status = capture([sys.executable, '-c', script, str(pidfile)], self.log,
                         timeout=None, exit_timeout=0.2)
        self.assertEqual(status, 124)
        self.assertLess(time.monotonic() - started, 5)
        self.assertIn('phase=output-drain timeout', self.contents('cleanup'))
        self.assertIn('descendant retains pipe', self.contents('cleanup'))
        self.assertIn('pgid=', self.contents('cleanup'))

    def test_capture_reports_cleanup_failure_even_when_failed_parent_closed_output(self):
        pgidfile = self.directory / 'capture.pgid'
        command = ['/bin/sh', '-c',
                   'trap "" TERM; sleep 60 >/dev/null 2>&1 & echo $$ > "$1"; exit 23',
                   'fixture', str(pgidfile)]
        self.assertEqual(capture(command, self.log, timeout=5), 124)
        self.assertIn('process_exit=23; cleanup required SIGKILL', self.contents('cleanup'))
        self.assertFalse(group_members(int(pgidfile.read_text())))

    def test_lingering_test_child_is_killed_without_replacing_original_failure(self):
        pidfile = self.directory / 'child.pid'
        script = '''import os, pathlib, signal, sys, time
if os.fork() == 0:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    os.close(1)
    os.close(2)
    pathlib.Path(sys.argv[1]).touch()
    time.sleep(60)
else:
    while not pathlib.Path(sys.argv[1]).exists(): time.sleep(0.01)
    sys.exit(23)
'''
        with patch('ci_diagnostics.collector', return_value=self.diagnostics), \
                patch.object(self.diagnostics, 'sample', return_value={}):
            self.assertEqual(run([sys.executable, '-c', script, str(pidfile)]), 23)
        self.assertEqual((self.directory / 'test.exit').read_text(), '23')
        self.assertTrue((self.directory / 'cleanup-failed').exists())
        self.assertIn('SIGKILL', self.contents('lifecycle'))
        self.assertFalse((self.directory / 'test-process.pid').exists())

    def test_cancel_stops_ignoring_child_and_preserves_signal_status(self):
        pidfile = self.directory / 'child.pid'
        script = ('import os,pathlib,signal,sys,time; '
                  'signal.signal(signal.SIGTERM, signal.SIG_IGN); '
                  'pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); time.sleep(60)')
        env = {**os.environ, 'ANDROID_DIAGNOSTICS_DIR': str(self.directory),
               'ANDROID_DIAGNOSTICS_TIMEOUT': '0.1'}
        process = subprocess.Popen([sys.executable, str(ROOT / 'ci_diagnostics.py'), 'run', '--',
                                    sys.executable, '-c', script, str(pidfile)],
                                   env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.wait_for(pidfile, process)
            process.send_signal(signal.SIGINT)
            self.assertEqual(process.wait(timeout=8), 130)
            self.assertEqual((self.directory / 'test.exit').read_text(), '130')
            self.assertFalse(group_members(int(pidfile.read_text())))
            self.assertTrue((self.directory / 'cleanup-failed').exists())
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=2)
            if pidfile.exists():
                try:
                    os.kill(int(pidfile.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def sdk(self, mode):
        sdk = self.directory / 'sdk'
        script = self.directory / 'native.py'
        script.write_text('''import os, pathlib, signal, sys, time
directory = pathlib.Path(os.environ['ANDROID_DIAGNOSTICS_DIR'])
if sys.argv[1] == 'adb':
    if os.environ['FIXTURE_MODE'] == 'adb-hang': time.sleep(60)
    (directory / 'native-stop').touch()
    sys.exit(0)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
(directory / 'native-ready').touch()
while os.environ['FIXTURE_MODE'] != 'normal' or not (directory / 'native-stop').exists():
    time.sleep(0.05)
print('native emulator stopped', flush=True)
''')
        for relative, kind in [('emulator/emulator', 'emulator'), ('platform-tools/adb', 'adb')]:
            path = sdk / relative
            path.parent.mkdir(parents=True)
            path.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" {kind} "$@"\n')
            path.chmod(0o755)
        install_binaries(sdk, self.diagnostics, ROOT)
        return sdk, {**os.environ, 'ANDROID_HOME': str(sdk), 'FIXTURE_MODE': mode,
                     'ANDROID_DIAGNOSTICS_DIR': str(self.directory), 'ANDROID_DIAGNOSTICS_TIMEOUT': '0.1'}

    def launch(self, sdk, env):
        process = subprocess.Popen([sys.executable, str(sdk / 'emulator/emulator'), '-avd', 'test'],
                                   env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

        def cleanup():
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            process.stdout.close()

        self.addCleanup(cleanup)
        self.wait_for(self.directory / 'native-ready', process)
        return process

    def test_wrapper_releases_action_pipes_and_normal_shutdown_is_successful(self):
        sdk, env = self.sdk('normal')
        process = self.launch(sdk, env)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(2), 'wrapper retained action stdout')
            self.assertEqual(os.read(process.stdout.fileno(), 1), b'')
        result = subprocess.run([sys.executable, str(sdk / 'platform-tools/adb'), 'emu', 'kill'],
                                env=env, timeout=20, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(process.wait(timeout=3), 0)
        self.assertEqual((self.directory / 'emulator.exit').read_text(), '0')
        self.assertFalse((self.directory / 'cleanup-failed').exists())
        self.assertIn('cleanup_exit=0', self.contents('cleanup'))
        with patch.dict(os.environ, env):
            restore()
        self.assertFalse((sdk / 'emulator/emulator.diagnostics-original').exists())

    def test_unresponsive_emulator_is_killed_and_cannot_pass_cleanup(self):
        sdk, env = self.sdk('emulator-hang')
        process = self.launch(sdk, env)
        pgid = int((self.directory / 'emulator-process.pid').read_text())
        started = time.monotonic()
        request_shutdown(self.directory)
        self.assertFalse(wait_emulator(self.directory, self.log))
        self.assertEqual(process.wait(timeout=2), 124)
        self.assertLess(time.monotonic() - started, 15)
        self.assertFalse(group_members(pgid))
        self.assertTrue((self.directory / 'cleanup-failed').exists())
        self.assertIn('phase=emulator-shutdown timeout', self.contents('emulator'))
        with patch('ci_diagnostics.collector', return_value=self.diagnostics), \
                patch('ci_diagnostics.directory', return_value=self.directory), \
                patch.object(self.diagnostics, 'sample', return_value={}), \
                patch.dict(os.environ, env):
            self.assertEqual(stop(), 1)

    def test_failed_cleanup_stage_does_not_skip_other_cleanup_or_restore(self):
        with patch('ci_diagnostics.collector', return_value=self.diagnostics), \
                patch('ci_diagnostics.directory', return_value=self.directory), \
                patch.object(self.diagnostics, 'sample', return_value={}), \
                patch('ci_diagnostics.wait_emulator', side_effect=OSError('broken state')), \
                patch('ci_diagnostics.stop_test') as tests, \
                patch('ci_diagnostics.stop_daemon') as daemon, \
                patch('diagnostics_wrappers.restore') as restore:
            self.assertEqual(stop(), 1)
        tests.assert_called_once()
        daemon.assert_called_once()
        restore.assert_called_once()

    def test_unresponsive_adb_has_its_own_deadline_and_failure_status(self):
        command = [sys.executable, '-c', 'import time; print("hung adb", flush=True); time.sleep(60)']
        with patch.object(self.diagnostics, 'sample', return_value={}):
            self.assertEqual(shutdown(command, self.diagnostics, timeout=0.2), 124)
        self.assertTrue((self.directory / 'cleanup-failed').exists())
        self.assertIn('phase=adb-emu-kill exit=124', self.contents('cleanup'))
        self.assertIn('hung adb', self.contents('cleanup'))

    def stubborn(self, pidfile):
        ready = self.directory / f'{pidfile}.ready'
        process = subprocess.Popen([sys.executable, '-c',
                                    'import pathlib,signal,sys,time; '
                                    'signal.signal(signal.SIGTERM, signal.SIG_IGN); '
                                    'pathlib.Path(sys.argv[1]).touch(); time.sleep(60)', str(ready)],
                                   start_new_session=True)

        def cleanup():
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=3)

        self.addCleanup(cleanup)
        self.wait_for(ready, process)
        (self.directory / pidfile).write_text(str(process.pid))
        return process

    def test_unresponsive_wrapper_fallback_kills_only_registered_processes(self):
        wrapper = self.stubborn('emulator-wrapper.pid')
        child = self.stubborn('emulator-process.pid')
        self.assertFalse(wait_emulator(self.directory, self.log, timeout=0.2))
        self.assertEqual(wrapper.wait(timeout=3), -signal.SIGKILL)
        self.assertEqual(child.wait(timeout=3), -signal.SIGKILL)
        self.assertIn('phase=emulator-wrapper timeout', self.contents('cleanup'))

    def test_unresponsive_collector_is_killed_and_cleanup_fails(self):
        collector = self.stubborn('collector.pid')
        (self.directory / 'ready').touch()
        with patch('ci_diagnostics.directory', return_value=self.directory):
            stop_daemon(self.log, timeout=0.2)
        self.assertEqual(collector.wait(timeout=3), -signal.SIGKILL)
        self.assertTrue((self.directory / 'cleanup-failed').exists())
        self.assertFalse((self.directory / 'collector.pid').exists())
        self.assertIn('phase=collector-shutdown timeout', self.contents('cleanup'))

    def test_killed_collector_cannot_leave_independent_logcat_session_alive(self):
        ready = self.directory / 'stream.ready'
        script = '''import signal, sys
from pathlib import Path
from diagnostics_io import BoundedLog, Redactor, capture
signal.signal(signal.SIGTERM, signal.SIG_IGN)
capture([sys.executable, '-c',
         'import pathlib,sys,time; pathlib.Path(sys.argv[1]).touch(); time.sleep(60)', sys.argv[2]],
        BoundedLog(Path(sys.argv[1]), 'logcat', Redactor({})), timeout=None)
'''
        process = subprocess.Popen([sys.executable, '-c', script, str(self.directory), str(ready)],
                                   env={**os.environ, 'PYTHONPATH': str(ROOT)}, start_new_session=True)

        def cleanup():
            if process.poll() is None:
                process.kill()
            process.wait(timeout=3)

        self.addCleanup(cleanup)
        self.wait_for(ready, process)
        (self.directory / 'collector.pid').write_text(str(process.pid))
        registration = next(self.directory.glob('diagnostic-process-*.pid'))
        pgid = int(registration.read_text())
        original_stop = stop_daemon
        with patch('ci_diagnostics.collector', return_value=self.diagnostics), \
                patch('ci_diagnostics.directory', return_value=self.directory), \
                patch.object(self.diagnostics, 'sample', return_value={}), \
                patch('ci_diagnostics.stop_daemon', side_effect=lambda log: original_stop(log, timeout=0.2)), \
                patch('diagnostics_wrappers.restore'):
            self.assertEqual(stop(), 1)
        self.assertEqual(process.wait(timeout=3), -signal.SIGKILL)
        deadline = time.monotonic() + 2
        while group_members(pgid) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(group_members(pgid))
        self.assertFalse(registration.exists())
        self.assertIn('phase=diagnostic-process-recovery', self.contents('lifecycle'))


if __name__ == '__main__':
    unittest.main()
