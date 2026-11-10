import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import * as util from 'node:util';
import test from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

const require = createRequire(import.meta.url);
const protocol = require('./surface-frame-protocol.ts');

/** 使用实际协议配合可控进程边界，保留异步读取、退出及取消语义。
 * @param options - 当前进程故障。
 */
function fixture(options = {}) {
  const events = [], observed = {};
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  /** 记录只属于当前子进程的最后清理。
   * @param signal - 进程信号。
   */
  child.kill = signal => { events.push(signal); child.exitCode = 137; child.emit('close', 137); };
  const { collectSurfaceFrames } = loadGameFlow('./surface-frame-recording.ts', {
    './surface-frame-protocol': protocol,
    'node:util': util,
    'node:timers/promises': {
      /** 保留相对时间和真实 AbortSignal，只缩短等待。
       * @param ms - 生产期限。
       * @param value - 返回值。
       * @param settings - 取消参数。
       */
      setTimeout: (ms, value, settings) => delay(ms / 50, value, settings),
    },
    'node:child_process': {
      /** 使用专用 shell v2，分离二进制标准输出。
       * @param executable - ADB。
       * @param args - 专用序列号、无 PTY 参数和固定命令。
       */
      spawn: (executable, args) => {
        assert.equal(executable, 'adb');
        assert.deepEqual(args.slice(0, 4), ['-s', 'emulator-6666', 'shell', '-T']);
        assert.match(args[4], /sleep 8 & sleeper=\$!; wait "\$sleeper"; kill -INT "\$recorder"/);
        events.push('spawn');
        void delay(2).then(() => { observed.sourceAt = performance.now(); emitSource(child, options); });
        return child;
      },
      /** 只停止本次 PID，模拟远端正常关闭后等待本地通道退出。
       * @param executable - ADB。
       * @param args - 本次 PID 的单次 SIGINT。
       * @param settings - 必须有超时。
       * @param callback - execFile 的标准回调。
       */
      execFile: (executable, args, settings, callback) => {
        assert.equal(executable, 'adb');
        assert.ok(['-INT', '-KILL'].includes(args[4]));
        assert.deepEqual(args, ['-s', 'emulator-6666', 'shell', 'kill', args[4], '4321']);
        assert.equal(settings.timeout, 2000);
        const forced = args[4] === '-KILL';
        events.push(forced ? 'force-stop' : 'stop');
        if (!forced) observed.stoppedAt = performance.now();
        if (options.stopHangs && !forced) { callback(null, '', ''); return; }
        child.exitCode = options.stopFailure ? 23 : 0;
        child.emit('close', child.exitCode);
        callback(null, '', '');
      },
    },
  });
  return { events, observed,
    /** Run within an isolated emulator serial and restore it after completion.
     * @param profile - Original capture timing profile.
     */
    run: async profile => {
      const before = process.env.ANDROID_SERIAL;
      process.env.ANDROID_SERIAL = 'emulator-6666';
      try {
        return await collectSurfaceFrames(async () => {
          observed.triggerAt = performance.now();
          events.push('trigger');
          if (options.triggerFailure) throw options.triggerFailure;
        }, async () => { events.push('preserve'); }, profile);
      } finally {
        if (before === undefined) delete process.env.ANDROID_SERIAL;
        else process.env.ANDROID_SERIAL = before;
      }
    },
  };
}

/** 模拟 ADB 源，不在触发后拼接或生成中途画面。
 * @param child - 当前子进程。
 * @param options - 单个失败边界。
 */
function emitSource(child, options) {
  if (options.earlyExit) { child.exitCode = 0; child.emit('close', 0); return; }
  child.stderr.emit('data', Buffer.from('CLRN_FRAME_PID=4321\n'));
  if (options.noFrame) return;
  const pixels = Buffer.alloc(240 * 426 * 3, 13);
  const header = Buffer.alloc(20);
  [pixels.length + 16, 240, 426, 720, 3].forEach((value, index) => header.writeUInt32LE(value, index * 4));
  if (options.malformed) header.writeUInt32LE(99, 16);
  child.stdout.emit('data', Buffer.concat([header, pixels]));
}

test('首帧和 PID 就绪后只触发一次，等待原窗口后停止本次 PID', async () => {
  const scene = fixture();
  const result = await scene.run();
  assert.deepEqual(scene.events, ['spawn', 'trigger', 'stop']);
  assert.equal(result.frames.length, 1);
  assert.ok(Number.isFinite(result.frames[0].capturedAt));
  assert.equal(result.stoppedTailBytes, 0);
});

for (const fault of ['earlyExit', 'malformed', 'noFrame']) {
  test(`${fault} 时取消尚未发生的触发，不能用缺少来源的画面通过`, async () => {
    const scene = fixture({ [fault]: true });
    await assert.rejects(scene.run(), /提前结束|帧头无效|启动超时/);
    await delay(15);
    assert.equal(scene.events.includes('trigger'), false);
  });
}

test('触发失败仍停止本次 PID，清理失败保留原错误身份', async () => {
  const failure = new Error('real close unavailable');
  const scene = fixture({ triggerFailure: failure, stopFailure: true });
  await assert.rejects(scene.run(), error => error === failure);
  assert.deepEqual(scene.events, ['spawn', 'trigger', 'preserve', 'stop']);
});

test('非零停止状态不能被作为成功采集返回', async () => {
  await assert.rejects(fixture({ stopFailure: true }).run(), /退出状态 23/);
});

test('录制不响应 SIGINT 时仅强杀本次 PID，原停止超时仍失败', async () => {
  const scene = fixture({ stopHangs: true });
  await assert.rejects(scene.run(), /停止超时/);
  assert.deepEqual(scene.events, ['spawn', 'trigger', 'stop', 'force-stop']);
});


test('video source preserves the original five-second window and one-second pre-trigger interval', async () => {
  const scene = fixture();
  await scene.run('video');
  assert.deepEqual(scene.events, ['spawn', 'trigger', 'stop']);
  assert.ok(scene.observed.triggerAt - scene.observed.sourceAt >= 19, 'trigger must wait the scaled original second');
  assert.ok(scene.observed.stoppedAt - scene.observed.sourceAt >= 99, 'stream must remain open for the scaled original five seconds');
});
