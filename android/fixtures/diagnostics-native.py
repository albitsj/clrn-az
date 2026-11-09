"""用途：只在生命周期单元测试中模拟 SDK 主进程及其关闭依赖。"""

import os
from pathlib import Path
import signal
import sys
import time


directory = Path(os.environ['ANDROID_DIAGNOSTICS_DIR'])
if sys.argv[1] == 'adb':
    if os.environ['FIXTURE_MODE'] == 'adb-hang':
        time.sleep(60)
    (directory / 'native-stop').touch()
    sys.exit(0)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
(directory / 'native-ready').touch()
mode = os.environ['FIXTURE_MODE']
child_pid = None


def graceful_stop(*_):
    """主进程负责通知辅助进程，并等待双方真实退出。"""
    if child_pid:
        os.kill(child_pid, signal.SIGTERM)
    time.sleep(3)
    if child_pid:
        os.waitpid(child_pid, 0)
    sys.exit(0)


def dependent_stop(*_):
    """辅助进程须保留到主进程发出专用关闭请求。"""
    time.sleep(0.1)
    os.kill(child_pid, signal.SIGUSR1)
    _, status = os.waitpid(child_pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))


def child_stop(sig, _):
    """专用关闭请求正常返回；提前终止保留异常退出码。"""
    sys.exit(0 if sig == signal.SIGUSR1 else 23)


if mode == 'graceful-stop':
    signal.signal(signal.SIGTERM, graceful_stop)
    child_pid = os.fork()
    if child_pid == 0:
        (directory / 'native-child-ready').touch()
if mode == 'parent-dependent-stop':
    signal.signal(signal.SIGTERM, dependent_stop)
    child_pid = os.fork()
    if child_pid == 0:
        signal.signal(signal.SIGTERM, child_stop)
        signal.signal(signal.SIGUSR1, child_stop)
        (directory / 'native-child-ready').touch()
while mode not in ['normal', 'nonzero-exit', 'signal-exit'] or not (directory / 'native-stop').exists():
    time.sleep(0.05)
if mode == 'nonzero-exit':
    sys.exit(23)
if mode == 'signal-exit':
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    os.kill(os.getpid(), signal.SIGTERM)
print('native emulator stopped', flush=True)
