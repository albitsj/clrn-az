import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

/** 用外部进程和文件边界替身运行生产录屏器，验证失败时的原片保留顺序。
 * @param options - 可注入触发、解码、拉取、报告和清理错误。
 */
function recording(options = {}) {
  const events = [];
  const recorder = new EventEmitter();
  recorder.stderr = new EventEmitter();
  recorder.exitCode = null;
  recorder.killed = false;
  /** 模拟 SIGINT 后录屏关闭，finished 可能拒绝。
   * @param signal - 结束信号。
   */
  recorder.kill = signal => {
    events.push(signal);
    recorder.killed = true;
    recorder.exitCode = 130;
    recorder.emit('close', 130);
  };
  const { recordNativeVideoFrames } = loadGameFlow('./video-frames.ts', {
    'node:child_process': {
      /** 模拟启动真实录屏命令。
       * @param program - 进程名。
       * @param args - 包含 screenrecord 的命令参数。
       */
      spawn: (program, args) => { events.push([program, ...args]); return recorder; },
      /** 模拟录屏解码边界。
       * @param program - 必须使用 ffmpeg。
       */
      execFileSync: program => { events.push(program); if (options.decodeFailure) throw options.decodeFailure; },
    },
    'node:fs': {
      /** 不需要建立实际目录。 */ mkdirSync: () => {},
      /** 返回足够的真实录屏帧路径。 */ readdirSync: () => Array.from({ length: 20 }, (_, i) => `frame-${i}.png`),
      /** 返回解码帧字节。 */ readFileSync: () => Buffer.from('frame'),
    },
    'node:path': { default: path },
    'node:timers/promises': { /** 模拟一秒预热已完成。 */ setTimeout: async () => { events.push('warmup'); } },
    './device': {
      /** 记录拉取和删除的顺序，支持独立故障。
       * @param args - ADB 参数。
       */
      adb: (...args) => {
        events.push(args);
        if (args[0] === 'pull' && options.pullFailure) throw new Error('pull unavailable');
        if (args[0] === 'shell' && options.cleanupFailure) throw new Error('cleanup unavailable');
      },
    },
  });
  return { events,
    /** 在隔离的模拟器编号下执行录屏函数并恢复环境。 */
    run: async () => {
      const previous = process.env.ANDROID_SERIAL;
      process.env.ANDROID_SERIAL = 'emulator-6666';
      try {
        return await recordNativeVideoFrames('rule-enter', { x: 130, y: 330, width: 460, height: 610 },
          async () => {
            events.push('trigger');
            if (options.triggerFailure) throw options.triggerFailure;
            recorder.exitCode = 0;
            recorder.emit('close', 0);
          }, { /** 报告原始视频必须发生在删除设备文件之前。
           * @param name - 视频附件名称。
           * @param data - 原始视频路径及类型。
           */
            attach: async (name, data) => {
              events.push(['attach', name, data.contentType]);
              if (options.attachFailure) throw new Error('attachment unavailable');
            },
          });
      } finally {
        if (previous === undefined) delete process.env.ANDROID_SERIAL;
        else process.env.ANDROID_SERIAL = previous;
      }
    },
  };
}

test('原生录屏先预热，再单次点击，保存原片和解码帧后清理', async () => {
  const scene = recording();
  assert.equal((await scene.run()).length, 20);
  assert.deepEqual(scene.events.slice(1, 3), ['warmup', 'trigger']);
  assert.equal(scene.events.filter(event => event === 'trigger').length, 1);
  assert.equal(scene.events.includes('SIGINT'), false);
  assert.deepEqual(scene.events.at(-1).slice(0, 3), ['shell', 'rm', '-f']);
  assert.ok(scene.events.findIndex(event => event[0] === 'attach') < scene.events.indexOf('ffmpeg'));
});

test('触发失败时先结束录制并附加原片，再删除设备文件，抛出同一原始错误', async () => {
  const failure = new Error('rule target moved during recording setup');
  const scene = recording({ triggerFailure: failure });
  await assert.rejects(scene.run(), error => error === failure);
  assert.deepEqual(scene.events.slice(1, 4), ['warmup', 'trigger', 'SIGINT']);
  assert.deepEqual(scene.events.slice(4).map(event => event[0]), ['pull', 'attach', 'shell']);
  assert.equal(scene.events.includes('ffmpeg'), false);
});

for (const fault of ['pullFailure', 'attachFailure', 'cleanupFailure']) {
  test(`触发失败后的 ${fault} 不能覆盖原错误或跳过清理`, async () => {
    const failure = new Error('first trigger failure');
    const scene = recording({ triggerFailure: failure, [fault]: true });
    await assert.rejects(scene.run(), error => error === failure);
    assert.equal(scene.events.at(-1)[0], 'shell');
    assert.equal(scene.events.filter(event => event === 'trigger').length, 1);
  });
}

test('解码失败时原片已经保存，不重复附加或覆盖解码错误', async () => {
  const failure = new Error('ffmpeg failed');
  const scene = recording({ decodeFailure: failure, cleanupFailure: true });
  await assert.rejects(scene.run(), error => error === failure);
  assert.equal(scene.events.filter(event => event[0] === 'attach').length, 1);
  assert.equal(scene.events.filter(event => event[0] === 'pull').length, 1);
});
