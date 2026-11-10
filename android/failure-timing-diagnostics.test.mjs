/** 诊断必须保留采样参数与原始失败，并拒绝复制未脱敏输出。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { expect } from '@playwright/test';
import { runInNewContext } from 'node:vm';
import { diagnosticSource } from './diagnostics-test-support.mjs';

/** 在生产模块边界注入设备、代理及报告故障。
 * @param file - 生产文件。
 * @param modules - 已替换的外部边界。
 */
function load(file, modules) {
  const exports = {};
  runInNewContext(diagnosticSource(file), { exports, Date,
    /** 返回本例独立依赖。
     * @param name - 模块名称。
     */ require: name => modules[name] });
  return exports;
}

test('滚轮首败诊断不改变参数、不重试点击，所有诊断故障仍保留原异常', async () => {
  const failure = new Error('第 1 个区域必须独立运动');
  const device = {}, reels = [{ x: 143, y: 420, width: 137, height: 362 }];
  let calls = 0, clicks = 0;
  /** 记录原始点击次数，诊断不得重新触发。 */
  const trigger = () => { clicks++; };
  const { captureSlotSpin } = load('./slot-spin.ts', {
    './animation-transition': { /** 在原采样边界注入断言失败。
       * @param args - 完整生产参数。
       */ captureNativeTransition: async (...args) => {
      calls++;
      assert.equal(args[0], device);
      assert.equal(args[4], trigger);
      assert.equal(args[6], reels);
      assert.deepEqual(JSON.parse(JSON.stringify(args[3])), { x: 124, y: 420, width: 469, height: 362 });
      assert.equal(args[7], 1500);
      assert.equal(args[8], 'challengeFrames');
      await args[4]();
      args[16]('native-sampling-start');
      throw failure;
    } },
    './animation-diagnostics': { /** 附件失败不能替换断言。 */ preserveAnimationFailure: async () => { throw new Error('private'); } },
  });
  for (const commandFails of [false, true]) {
    const proxy = { /** 仅允许失败后读取状态，不可修改夹具。
       * @param endpoint - 控制接口。
       */ command: async endpoint => {
      assert.equal(endpoint, 'android/slot');
      if (commandFails) throw new Error('private');
      return { spins: 2, lastSpinAt: 123, token: 'must-not-copy' };
    } };
    const info = { /** 白名单响应字段不得包含代理额外数据。
       * @param name - 附件名称。
       * @param value - 附件数据。
       */ attach: async (name, value) => {
      assert.equal(name, 'slot-currency_diamond-reels-response-timing');
      assert.equal(value.body.includes('must-not-copy'), false);
      assert.equal(JSON.parse(value.body).lastSpinAt, 123);
      throw new Error('report failure');
    } };
    await assert.rejects(captureSlotSpin(device, proxy, 'currency_diamond', info, trigger, reels), error => error === failure);
  }
  assert.equal(calls, 2);
  assert.equal(clicks, 2);
});

test('渲染诊断只保留数字，设备读取与附件失败都不抛出', async () => {
  let failRead = false;
  const { renderStatistics, preserveRenderStatistics } = load('./render-diagnostics.ts', {
    './device': { applicationId: 'test.app', /** 模拟已有渲染统计读取，不重置数据。
       * @param args - 设备命令。
       */ adb: (...args) => {
      assert.deepEqual(args, ['shell', 'dumpsys', 'gfxinfo', 'test.app', 'framestats']);
      if (failRead) throw new Error('secret-device-payload');
      return 'Window: private-token\nTotal frames rendered: 42\n1,100,200,\n';
    } },
  });
  const stats = JSON.parse(JSON.stringify(renderStatistics('Window private\nJanky frames: 2 (5%)\n1,100,-1,\n')));
  assert.deepEqual(stats, { summary: [{ metric: 'Janky frames', count: 2 }], frames: [[1, 100, -1]] });
  const info = { /** 报告故障仍不能使诊断抛出。
     * @param name - 附件名。
     * @param value - 白名单数据。
     */ attach: async (name, value) => {
    assert.equal(value.body.includes('private-token'), false);
    throw new Error('secret-report-payload');
  } };
  await preserveRenderStatistics('texas-holdem-voice-enter', info);
  await preserveRenderStatistics('slot-popup-exit', info);
  failRead = true;
  await preserveRenderStatistics('texas-holdem-voice-enter', info);
  await preserveRenderStatistics('slot-popup-exit', info);
});

test('启动传输诊断只探测当前专用代理，不复制路由、端口或异常正文', async () => {
  const calls = [], attachments = [];
  let offline = false;
  const { preserveProxyTransport } = load('./proxy-transport-diagnostics.ts', {
    './device-command': {
      /** 执行只读命令的替身，故障正文不能进入附件。
       * @param args - 生产命令。
       */ adb: (...args) => {
        calls.push(args);
        if (offline) throw new Error('private-transport-error');
        if (args.includes('settings')) return '10.0.2.2:12345\n';
        if (args.includes('route')) return 'default via 10.0.2.1 dev wlan0 private-route\n';
        assert.deepEqual(args, ['shell', 'toybox', 'nc', '-z', '-w', '3', '10.0.2.2', '12345']);
        return '';
      },
    },
  });
  const info = { /** 保存白名单诊断。
     * @param name - 附件名。
     * @param data - 附件内容。
     */ attach: async (name, data) => {
    assert.equal(name, 'launch-proxy-transport');
    assert.doesNotMatch(data.body, /private|12345/);
    attachments.push(JSON.parse(data.body));
  } };
  await preserveProxyTransport(info);
  assert.equal(calls.length, 3);
  assert.equal(attachments[0].proxyReachable, true);
  assert.equal(attachments[0].defaultRoute, true);
  offline = true;
  await preserveProxyTransport(info);
  assert.equal(calls.length, 5, '配置读取失败不能探测猜测的端口');
  assert.equal(attachments[1].proxyReachable, null);
  assert.equal(attachments[1].routesReadable, false);
  await preserveProxyTransport({ /** 附件存储故障不能抛出。 */ attach: async () => { throw new Error('report unavailable'); } });
});


test('带入审核诊断输出失败不能触发原回放的重试', async () => {
  const exports = {};
  let commands = 0;
  const modules = {
    '@playwright/test': { expect },
    './game-controls': {},
    './game-room': { /** 返回本例的已验证房间。 */ gameSession: async () => ({ room: { roomId: 'room' } }) },
  };
  runInNewContext(diagnosticSource('./game-replay.ts'), { exports, Date,
    console: { /** 模拟写入诊断输出失败。 */ log: () => { throw new Error('output unavailable'); } },
    /** 只替换原外部边界。
     * @param name - 模块名。
     */ require: name => modules[name],
  });
  await exports.replay({ /** 记录原回放请求，不允许诊断增加发送次数。 */ command: async () => {
    commands++;
    return { replayedMessages: 1 };
  } }, 'texas', 'room', { scene: 'buy-in-review' });
  assert.equal(commands, 1);
});
