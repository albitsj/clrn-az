/** 独立诊断分支专用：记录真实屏幕帧与调度，不修改被测应用或采样。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';

const config = `buffers { size_kb: 16384 fill_policy: RING_BUFFER }
duration_ms: 10000
data_sources { config { name: "android.surfaceflinger.frametimeline" } }
data_sources { config { name: "linux.ftrace" ftrace_config {
  ftrace_events: "sched/sched_switch"
  ftrace_events: "sched/sched_waking"
} } }
data_sources { config { name: "linux.process_stats" process_stats_config {
  scan_all_processes_on_start: true
} } }
`;

/** 只操作当前专用模拟器，诊断命令具有独立期限。
 * @param args - 已知命令与参数。
 */
function traceAdb(...args: string[]): string {
  const serial = process.env.ANDROID_SERIAL || '';
  if (!/^emulator-\d+$/.test(serial)) throw new Error('Trace requires dedicated emulator');
  return execFileSync('adb', ['-s', serial, ...args], {
    encoding: 'utf8', timeout: 40_000, maxBuffer: 1_048_576,
  });
}

/** 启动固定十秒、16MiB 的系统帧时间线；启动失败仅记录诊断状态。
 * @param info - 当前实际尝试报告。
 */
export async function startSlotFrameTrace(info: TestInfo): Promise<() => Promise<void>> {
  const token = `clrn-slot-${process.pid}-${Date.now()}`;
  const remote = `/data/misc/perfetto-traces/${token}.perfetto-trace`;
  const remoteConfig = `/data/local/tmp/${token}.pbtx`;
  const localConfig = info.outputPath(`${token}.pbtx`);
  const localTrace = info.outputPath(`${token}.perfetto-trace`);
  let pid = '', readyAt = 0;
  try {
    writeFileSync(localConfig, config);
    traceAdb('push', localConfig, remoteConfig);
    pid = traceAdb('shell', 'perfetto', '--background-wait', '--txt', '-c', remoteConfig, '-o', remote).trim();
    if (!/^\d+$/.test(pid)) throw new Error('Trace did not return owned PID');
    readyAt = Date.now();
    await info.attach('slot-frame-trace-start', {
      body: JSON.stringify({ readyAt, durationMs: 10000, bufferKiB: 16384, pid }), contentType: 'application/json',
    });
  } catch {
    await info.attach('slot-frame-trace-start-failed', { body: 'Trace unavailable', contentType: 'text/plain' });
  }
  /** 期限结束并确认进程已退出后读取；保留的文件不包含网络或输入文本采集。 */
  return async () => {
    try {
      if (!readyAt) return;
      await setTimeout(Math.max(0, readyAt + 11_000 - Date.now()));
      const alive = traceAdb('shell', `if kill -0 ${pid} 2>/dev/null; then echo alive; else echo finished; fi`).trim();
      if (alive !== 'finished') throw new Error('Trace still writing');
      traceAdb('pull', remote, localTrace);
      await info.attach('slot-popup-exit-frametimeline', { path: localTrace, contentType: 'application/octet-stream' });
    } catch {
      await info.attach('slot-frame-trace-collection-failed', { body: 'Trace unavailable or incomplete', contentType: 'text/plain' });
    }
  };
}
