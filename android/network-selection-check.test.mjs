import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForNetworkSelection } from './network-selection-check.ts';

const host = '67.hk-sn.api.staging.laiwan.shafayouxi.com';
const node64 = '64.kr-seoul.api.staging.laiwan.shafayouxi.com';
const node68 = '68.kr.api.staging.laiwan.shafayouxi.com';

/**
 * 构造脱敏的真实事件形状，不访问服务器或修改代理响应。
 * @param scene - 本轮选线模式。
 */
function evidence(scene) {
  const candidates = scene === 'network-64-unavailable' ? [node64, host, node68] : [host, node68];
  return [
    { event: 'response', host, path: '/public/v13/metadata/servers', candidates },
    { event: 'response', host: node64, path: '/node/v1/status', status: 503 },
    { event: 'response', host: node68, path: '/node/v1/status', status: 503 },
    { event: 'response', host, path: '/node/v1/status', status: 200, backend_delay: 88 },
    { event: 'websocket-connected', host, path: '/v2/centrifugo/connection/websocket', status: 101 },
    { event: 'websocket-ack', host, path: '/v2/centrifugo/connection/websocket', kind: 'connect', status: 101 },
  ];
}

for (const scene of ['network-64-unavailable', 'network-without-64']) {
  test(`${scene} 等待 metadata、握手和 ACK 先后到达`, /** 重现首次轮询时尚无连接、稍后才收到 ACK。 */ async () => {
    const events = evidence(scene);
    const snapshots = [[], events.slice(0, 4), events.slice(0, 5), events];
    let reads = 0;
    await waitForNetworkSelection(/** 每次只返回当前阶段已经观察到的证据。 */
      async () => ({ events: snapshots[Math.min(reads++, snapshots.length - 1)] }), scene, 2_000);
    assert.ok(reads >= snapshots.length, '中途断言失败也必须重新读取，不能提前结束或接受缺失 ACK');
  });
}

const invalid = [
  ['缺少 metadata', 'network-without-64', [], /必须使用本次代理返回的 metadata/],
  ['没有握手', 'network-without-64', evidence('network-without-64').slice(0, 4), /必须建立原生 WebSocket 连接/],
  ['没有 ACK', 'network-without-64', evidence('network-without-64').slice(0, 5), /必须收到原生连接 ACK/],
  ['连接不在候选中', 'network-without-64', [{ ...evidence('network-without-64')[0], candidates: [node68] },
    ...evidence('network-without-64').slice(1)], /toContain/],
  ['ACK 来自其他节点', 'network-without-64', [...evidence('network-without-64').slice(0, 5),
    { ...evidence('network-without-64')[5], host: node68 }], /必须收到原生连接 ACK/],
  ['故障模式缺少真实健康数据', 'network-64-unavailable', evidence('network-64-unavailable').toSpliced(3, 1), /67 必须保留真实健康响应/],
  ['未实际返回故障响应', 'network-64-unavailable', evidence('network-64-unavailable').toSpliced(1, 1), /64 必须确实收到故障响应/],
];

for (const [name, scene, events, message] of invalid) {
  test(`${name} 在等待期限后仍须失败`, /** 保留所有节点、握手、健康和 ACK 门禁。 */ async () => {
    await assert.rejects(waitForNetworkSelection(/** 持续返回不完整或不匹配的证据。 */
      async () => ({ events }), scene, 150), message);
  });
}
