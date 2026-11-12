import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

test('启动传输诊断只探测当前专用代理，不复制路由、端口或异常正文', async () => {
  const calls = [], attachments = [];
  let offline = false;
  const { preserveProxyTransport } = loadGameFlow('./proxy-transport-diagnostics.ts', {
    './device-command': {
      /** 执行只读命令的替身，故障正文不能进入附件。
       * @param args - 生产命令。
       */ adb: (...args) => {
        calls.push(args);
        if (offline) throw new Error('private-transport-error');
        const responses = new Map([
          ['shell settings get global http_proxy', '10.0.2.2:12345\n'],
          ['shell ip route show', 'default via 10.0.2.1 dev wlan0 private-route\n'],
          ['shell toybox nc -z -w 3 10.0.2.2 12345', ''],
        ]);
        assert.ok(responses.has(args.join(' ')));
        return responses.get(args.join(' '));
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
