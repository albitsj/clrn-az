import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { collectTransientFrames } = require('./game-transient-session.ts');

/** 模拟独立的驱动采集和 ADB 就绪通道。
 * @param options - 就绪状态和单次触发错误。
 */
function session(options = {}) {
  const events = [], attachments = [];
  let token, finish;
  let ready = options.ready ?? true;
  const pending = new Promise(resolve => { finish = resolve; });
  const device = { _connection: { /** 仅驱动通道负责采集。 */ toImpl: () => ({
    /** 开始采集，但不会假定设备已经就绪。
     * @param method - 原生命令。
     * @param parameters - 本轮随机身份。
     */ _send: (method, parameters) => {
      assert.equal(method, 'transientFrames');
      token = parameters.readyToken;
      events.push('requested');
      return pending;
    },
  }) },
  /** 独立 ADB 通道只读取专用标记。
   * @param command - 日志查询命令。
   */ shell: async command => {
    assert.equal(command, 'logcat -d -v raw -s ClrnTransientReady:I');
    events.push('probe');
    if (options.logFailure) throw options.logFailure;
    return Buffer.from(ready ? `unrelated\n${token}\n${token}:seen=2,lostAfter=0,frames=2` : 'another-session-token');
  } };
  return { events, attachments, finish,
    /** 允许测试独立控制设备就绪时间。 */ ready: () => { ready = true; },
    /** 执行生产会话；触发器只允许发送一次。 */ run: () => collectTransientFrames(device, 'result', undefined, async () => {
      events.push('trigger');
      if (options.failure) throw options.failure;
      finish(['first', 'second']);
      return '+10';
    }, { name: 'prediction', info: {
      /** 保存脱敏元数据。
       * @param name - 附件名。
       * @param data - 附件载荷。
       */ attach: async (name, data) => {
        if (options.attachFailure) throw new Error('report unavailable');
        attachments.push([name, JSON.parse(data.body)]);
      },
    } }),
  };
}

test('延迟设备就绪时禁止提前发送事件，就绪后只发送一次', async () => {
  const scene = session({ ready: false });
  const result = scene.run();
  await setImmediate();
  assert.equal(scene.events.includes('trigger'), false);
  scene.ready();
  assert.deepEqual(await result, { frames: ['first', 'second'], expectedText: '+10' });
  assert.equal(scene.events.filter(event => event === 'trigger').length, 1);
  const window = scene.attachments[0][1];
  assert.deepEqual(window.events.map(item => item.event),
    ['requested', 'device-ready', 'trigger-start', 'trigger-complete', 'collected']);
  assert.equal(window.native.length, 1);
  assert.equal(JSON.stringify(window).includes('unrelated'), false);
});

test('采集先于触发结束时拒绝过期事件并保留时间线', async () => {
  const scene = session({ ready: false });
  const result = scene.run();
  scene.finish([]);
  await assert.rejects(result, /事件触发前已经结束/);
  assert.equal(scene.events.includes('trigger'), false);
  assert.equal(scene.attachments.length, 1);
});

test('设备未确认就绪时有界超时，不发送事件且取消后台轮询', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const scene = session({ ready: false });
  const result = assert.rejects(scene.run(), /就绪确认超时/);
  await setImmediate();
  context.mock.timers.tick(3_000);
  await result;
  const count = scene.events.length;
  context.mock.timers.tick(30_000);
  await setImmediate();
  assert.equal(scene.events.length, count);
  assert.equal(scene.events.includes('trigger'), false);
});

test('触发失败只发送一次并原样保留错误', async () => {
  const failure = new Error('replay failed');
  const scene = session({ failure });
  await assert.rejects(scene.run(), error => error === failure);
  assert.equal(scene.events.filter(event => event === 'trigger').length, 1);
  assert.equal(scene.attachments.length, 1);
});

test('就绪查询出错时不发送事件，失败诊断仍不能覆盖查询错误', async () => {
  const failure = new Error('ADB log query failed');
  const scene = session({ logFailure: failure, attachFailure: true });
  await assert.rejects(scene.run(), error => error === failure);
  assert.equal(scene.events.includes('trigger'), false);
});

test('事件失败后的附件写入错误不能覆盖原始错误', async () => {
  const failure = new Error('original replay error');
  const scene = session({ failure, attachFailure: true });
  await assert.rejects(scene.run(), error => error === failure);
  assert.equal(scene.events.filter(event => event === 'trigger').length, 1);
});
