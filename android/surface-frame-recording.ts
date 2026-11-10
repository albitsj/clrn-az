import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { SurfaceFrameParser } from './surface-frame-protocol';

export type SurfaceFrame = { capturedAt: number; rgb: Buffer };
const execute = promisify(execFile);
// 原始帧分支不执行 screenrecord 的编码器时限检查；由同一 shell 设置独立的 8 秒保险。
export const surfaceRecordingCommand = 'screenrecord --output-format=frames --size 240x426 - & recorder=$!; '
  + 'printf "CLRN_FRAME_PID=%s\\n" "$recorder" >&2; '
  + '(sleep 8; kill -INT "$recorder" 2>/dev/null; sleep 2; kill -KILL "$recorder" 2>/dev/null) '
  + '</dev/null >/dev/null 2>&1 & guard=$!; '
  + 'wait "$recorder"; result=$?; kill "$guard" 2>/dev/null; wait "$guard" 2>/dev/null; exit "$result"';

/** 连续接收 SurfaceFlinger 原始帧；接收期间不编码 PNG，不阻塞事件循环。
 * @param trigger - 第一帧和进程握手后，仅执行一次的异步真实操作。
 * @param preserveFailure - 原异常发生后，在设备清理前保存宿主现场。
 */
export async function collectSurfaceFrames(trigger: () => unknown, preserveFailure: () => Promise<void>): Promise<{
  frames: SurfaceFrame[]; stderr: string; stoppedTailBytes: number }> {
  const serial = process.env.ANDROID_SERIAL || '';
  if (!/^emulator-\d+$/.test(serial)) throw new Error('原始采帧仅允许专用 Android 模拟器');
  const session = new SurfaceRecording(serial);
  const controller = new AbortController();
  const main = captureWindow(session, trigger, controller.signal);
  let completed = false;
  try {
    await Promise.race([main, session.failure]);
    completed = true;
  } catch (error) {
    await preserveFailure().catch(() => undefined);
    throw error;
  } finally {
    controller.abort();
    await session.stop().catch(error => { if (completed) throw error; });
  }
  return { frames: session.frames, stderr: session.stderr, stoppedTailBytes: session.parser.tailBytes() };
}

/** 从实际就绪开始观察原 3.2 秒窗口，不以固定帧率替代实际采样时间。
 * @param session - 本次拥有的原始帧进程。
 * @param trigger - 实际关闭按钮。
 * @param signal - 失败时取消尚未执行的真实操作。
 */
async function captureWindow(session: SurfaceRecording, trigger: () => unknown, signal: AbortSignal): Promise<void> {
  const deadline = setTimeout(4_000, undefined, { signal }).then(() => { throw new Error('原始采帧启动超时'); });
  await Promise.race([session.ready, deadline]);
  await Promise.all([setTimeout(3_200, undefined, { signal }),
    setTimeout(300, undefined, { signal }).then(() => trigger())]);
}

/** 仅管理本次 shell 返回的 PID；不使用 killall 或其他进程的文件。 */
class SurfaceRecording {
  readonly parser = new SurfaceFrameParser();
  readonly frames: SurfaceFrame[] = [];
  readonly ready: Promise<void>;
  readonly failure: Promise<never>;
  stderr = '';
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly closed: Promise<number | null>;
  private resolveReady!: () => void;
  private rejectFailure!: (error: Error) => void;
  private remotePid?: string;
  private stopping = false;

  /** 建立二进制 shell v2 通道，标准错误单独接收握手。
   * @param serial - 已验证的专用模拟器序列号。
   */
  constructor(private readonly serial: string) {
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    this.failure = new Promise((_, reject) => { this.rejectFailure = reject; });
    this.child = spawn('adb', ['-s', serial, 'shell', '-T', surfaceRecordingCommand], { stdio: 'pipe' });
    this.closed = new Promise(resolve => this.child.once('close', resolve));
    this.child.on('error', error => this.rejectFailure(error));
    this.child.stdout.on('data', chunk => this.receive(chunk));
    this.child.stderr.on('data', chunk => this.diagnostic(chunk));
    void this.closed.then(code => {
      if (!this.stopping) this.rejectFailure(new Error(`原始采帧提前结束 (${code})：${this.stderr}`));
    });
  }

  /** 检查完整原始包，主机收到完整帧时才打时间戳。
   * @param chunk - 当前 ADB 数据。
   */
  private receive(chunk: Buffer): void {
    if (this.stopping) return;
    try {
      this.frames.push(...this.parser.push(chunk).map(rgb => ({ capturedAt: performance.now(), rgb })));
      this.checkReady();
    } catch (error) { this.rejectFailure(error as Error); }
  }

  /** 保存有界错误输出，并从自己的握手中取得 PID。
   * @param chunk - 当前标准错误数据。
   */
  private diagnostic(chunk: Buffer): void {
    this.stderr = (this.stderr + chunk.toString()).slice(0, 8_192);
    this.remotePid = /^CLRN_FRAME_PID=([1-9][0-9]*)$/m.exec(this.stderr)?.[1];
    this.checkReady();
  }

  /** 完整首帧与 PID 缺一不可。 */
  private checkReady(): void {
    if (this.remotePid && this.frames.length) this.resolveReady();
  }

  /** 停止本次录制并等待通道关闭，清理错误不能制造成功结果。 */
  async stop(): Promise<void> {
    this.stopping = true;
    try {
      if (this.remotePid && this.child.exitCode === null) {
        await execute('adb', ['-s', this.serial, 'shell', 'kill', '-INT', this.remotePid], { timeout: 2_000 });
      }
      await boundedClose(this.closed);
    } finally {
      if (this.child.exitCode === null) {
        if (this.remotePid) await execute('adb', ['-s', this.serial, 'shell', 'kill', '-KILL', this.remotePid],
          { timeout: 2_000 }).catch(() => undefined);
        if (this.child.exitCode === null) this.child.kill('SIGKILL');
      }
    }
  }
}

/** 有界等待本次通道退出，不保留超时定时器。
 * @param closed - 录制进程的退出事件。
 */
async function boundedClose(closed: Promise<number | null>): Promise<void> {
  const controller = new AbortController();
  try {
    const timeout = setTimeout(2_000, undefined, { signal: controller.signal }).then(() => {
      throw new Error('原始采帧停止超时');
    });
    const code = await Promise.race([closed, timeout]);
    if (code !== 0) throw new Error(`原始采帧退出状态 ${code}`);
  } finally { controller.abort(); }
}
