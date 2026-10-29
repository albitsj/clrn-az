import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import childProcess from 'node:child_process';
import http from 'node:http';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { withAndroidProxy } = require('./proxy.ts');
const { MitmdumpProcess } = require('../e2e/helpers/mitmproxy-process.ts');

/**
 * 运行真实代理会话，仅替换外部 Android 命令和代理子进程。
 * @param context - 当前测试隔离的 mock 管理器。
 * @param failCommand - 可选的故障命令判断。
 */
function session(context, failCommand = () => undefined) {
  const commands = [];
  const servers = [];
  let fixtureEnvironment;
  const createServer = http.createServer;
  context.mock.method(http, 'createServer', (...argumentsList) => {
    const server = createServer(...argumentsList);
    servers.push(server);
    return server;
  });
  context.mock.method(childProcess, 'execFileSync', (executable, argumentsList, options) => {
    if (executable === 'openssl') return '01234567\n';
    assert.equal(executable, 'adb');
    assert.deepEqual(argumentsList.slice(0, 2), ['-s', 'emulator-5554']);
    assert.equal(options.timeout, 120_000);
    const command = argumentsList.slice(2).join(' ');
    commands.push(command);
    const failure = failCommand(command);
    if (failure) throw failure;
    if (command === 'shell getprop ro.kernel.qemu') return '1\n';
    if (command === 'shell id -u') return '0\n';
    if (command === 'shell settings get global http_proxy') return 'null\n';
    return '';
  });
  context.mock.method(childProcess, 'spawn', (_executable, _argumentsList, options) => {
    fixtureEnvironment = options.env;
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    /** 仅终止本测试的代理替身，并通知真实进程管理器。 */
    child.kill = () => {
      child.exitCode = 0;
      child.emit('close');
    };
    return child;
  });
  context.mock.method(MitmdumpProcess.prototype, 'waitUntilReady', async () => {});
  const originalSerial = process.env.ANDROID_SERIAL;
  process.env.ANDROID_SERIAL = 'emulator-5554';
  context.after(() => {
    if (originalSerial === undefined) delete process.env.ANDROID_SERIAL;
    else process.env.ANDROID_SERIAL = originalSerial;
    assert.equal(servers.length, 0, '不应启动 TypeScript HTTP 夹具服务');
  });
  return { commands, /** 返回代理真实收到的本轮夹具连接信息。 */ environment: () => fixtureEnvironment };
}

test('代理重试先有界等待指定模拟器连接，再读取旧设置，且不启动响应服务', async context => {
  const state = session(context);
  const result = await withAndroidProxy(async () => {
    const environment = state.environment();
    assert.equal(environment.ANDROID_FIXTURE_URL, undefined);
    assert.equal(environment.ANDROID_FIXTURE_TOKEN, undefined);
    assert.equal(environment.ANDROID_SCENE, 'pages');
    return 'completed';
  });
  assert.equal(result, 'completed');
  assert.deepEqual(state.commands.slice(0, 2), ['wait-for-device', 'shell settings get global http_proxy']);
  assert.ok(state.commands.some(command => /^shell toybox nc -z -w 3 10\.0\.2\.2 \d+$/.test(command)));
  assert.ok(state.commands.some(command => /^shell settings put global http_proxy 10\.0\.2\.2:\d+$/.test(command)));
  assert.equal(state.commands.at(-1), 'shell settings put global http_proxy :0');
  assert.ok(state.commands.every(command => !command.startsWith('reverse ')));
});

test('模拟器无法连接主机回环映射时使用专用反向转发并在结束后清理', async context => {
  const state = session(context, command => command.startsWith('shell toybox nc ') ? new Error('代理端口不可达') : undefined);
  assert.equal(await withAndroidProxy(async () => '已进入测试'), '已进入测试');
  const probe = state.commands.find(command => command.startsWith('shell toybox nc '));
  assert.ok(probe);
  const port = probe.split(' ').at(-1);
  const reverse = `reverse tcp:${port} tcp:${port}`;
  const configure = `shell settings put global http_proxy 127.0.0.1:${port}`;
  const restore = 'shell settings put global http_proxy :0';
  const remove = `reverse --remove tcp:${port}`;
  assert.ok(state.commands.includes(reverse));
  assert.ok(state.commands.includes(configure));
  assert.ok(state.commands.includes(restore));
  assert.ok(state.commands.indexOf(reverse) < state.commands.indexOf(configure));
  assert.ok(state.commands.indexOf(configure) < state.commands.indexOf(restore));
  assert.ok(state.commands.indexOf(restore) < state.commands.indexOf(remove));
  assert.equal(state.commands.at(-1), remove);
});

test('模拟器重连已清除反向转发时仍能完成代理恢复', async context => {
  const state = session(context, command => {
    if (command.startsWith('shell toybox nc ')) return new Error('代理端口不可达');
    if (command.startsWith('reverse --remove ')) return new Error(`listener '${command.split(' ').at(-1)}' not found`);
    return undefined;
  });
  assert.equal(await withAndroidProxy(async () => '已进入测试'), '已进入测试');
  assert.ok(state.commands.some(command => command.startsWith('reverse --remove ')));
});

for (const failedCommand of ['wait-for-device', 'shell settings get global http_proxy']) {
  test(`${failedCommand} 失败清理会话，不执行测试或写入未知的旧代理设置`, async context => {
    const failure = new Error('adb: device offline');
    const state = session(context, command => command === failedCommand ? failure : undefined);
    await assert.rejects(withAndroidProxy(async () => assert.fail('不应启动原生场景')), error => error === failure);
    assert.equal(state.environment(), undefined);
    assert.ok(state.commands.every(command => !command.includes('settings put')));
  });
}

test('原始失败和代理设置恢复失败全部保留', async context => {
  const primary = new Error('安装超时');
  const restore = new Error('代理设置恢复失败');
  session(context, command => command === 'shell settings put global http_proxy :0' ? restore : undefined);
  await assert.rejects(withAndroidProxy(async () => { throw primary; }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, primary);
    assert.deepEqual(error.errors, [primary, restore]);
    for (const failure of error.errors) assert.ok(error.message.includes(failure.message));
    return true;
  });
});

test('清理成功时保留原始错误对象，不重试或吞掉原生失败', async context => {
  const failure = new Error('原生截图失败');
  const state = session(context);
  let attempts = 0;
  await assert.rejects(withAndroidProxy(async () => { attempts++; throw failure; }), error => error === failure);
  assert.equal(attempts, 1);
  assert.equal(state.commands.at(-1), 'shell settings put global http_proxy :0');
});

test('正文成功但代理设置恢复失败仍然失败，不能误报视觉成功', async context => {
  const failure = new Error('代理设置恢复失败');
  session(context, command => command === 'shell settings put global http_proxy :0' ? failure : undefined);
  await assert.rejects(withAndroidProxy(async () => 'completed'), error => error === failure);
});
