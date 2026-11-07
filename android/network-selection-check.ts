import { expect } from '@playwright/test';

export type SelectionEvent = {
  event: string; host: string; path: string; status?: number;
  candidates?: string[]; backend_delay?: number; kind?: string;
};
export type Selection = { events: SelectionEvent[] };
export type SelectionScene = 'network-64-unavailable' | 'network-without-64';

/**
 * 从实际地区域名读取节点编号。
 * @param host - 代理观察到的节点域名。
 */
function nodeNumber(host: string): string { return host.split('.')[0]; }

/**
 * 核对故障节点的实际响应及正常节点的真实健康数据。
 * @param events - 本次代理记录的事件。
 */
function unavailableHealth(events: SelectionEvent[]): void {
  for (const node of ['64', '68']) {
    expect(events.some(/** 判断指定故障节点是否返回 503。
     * @param event - 代理事件。
     */ event => nodeNumber(event.host) === node && event.path === '/node/v1/status'
      && event.status === 503), `${node} 必须确实收到故障响应`).toBe(true);
  }
  expect(events.some(/** 判断正常节点是否保留真实健康响应。
   * @param event - 代理事件。
   */ event => nodeNumber(event.host) === '67' && event.path === '/node/v1/status'
    && event.status === 200 && typeof event.backend_delay === 'number'), '67 必须保留真实健康响应').toBe(true);
}

/**
 * 核对当前代理返回的候选列表，不能用旧连接代替本轮选线。
 * @param events - 本次代理记录的事件。
 * @param scene - 当前异常模式。
 */
function candidatesFor(events: SelectionEvent[], scene: SelectionScene): string[] {
  const metadata = events.filter(/** 找到含候选列表的真实 metadata。
   * @param event - 代理事件。
   */ event => event.candidates);
  expect(metadata.length, '必须使用本次代理返回的 metadata').toBeGreaterThan(0);
  const candidates = metadata.flatMap(/** 合并本轮观察到的候选节点。
   * @param event - metadata 事件。
   */ event => event.candidates!);
  const numbers = candidates.map(nodeNumber);
  if (scene === 'network-64-unavailable') {
    expect(new Set(numbers)).toEqual(new Set(['64', '67', '68']));
    unavailableHealth(events);
  } else {
    expect(numbers).not.toContain('64');
    expect(candidates.length).toBeGreaterThan(0);
  }
  return candidates;
}

/**
 * 等待整组原生选线断言成立，metadata、连接和 ACK 可以先后到达。
 * @param read - 读取本次代理的当前事件快照。
 * @param scene - 当前异常模式。
 * @param timeout - 等待整组断言的上限，设备验收默认保持 30 秒。
 */
export async function waitForNetworkSelection(read: () => Promise<Selection>, scene: SelectionScene,
  timeout = 30_000): Promise<void> {
  await expect(/** 每次重新读取并完整核对本轮选线证据。 */ async () => {
    const { events } = await read();
    const candidates = candidatesFor(events, scene);
    const connections = events.filter(/** 找到已完成真实握手的原生连接。
     * @param event - 代理事件。
     */ event => event.event === 'websocket-connected' && event.status === 101);
    expect(connections.length, '必须建立原生 WebSocket 连接').toBeGreaterThan(0);
    for (const connection of connections) {
      expect(nodeNumber(connection.host)).not.toBe('64');
      expect(candidates).toContain(connection.host);
      if (scene === 'network-64-unavailable') expect(nodeNumber(connection.host)).toBe('67');
    }
    expect(events.some(/** 连接确认必须来自本轮已握手的同一主机。
     * @param event - 代理事件。
     */ event => event.event === 'websocket-ack' && event.kind === 'connect'
      && connections.some(/** 核对 ACK 与实际握手的主机一致。
       * @param connection - 本轮原生连接。
       */ connection => connection.host === event.host)), '必须收到原生连接 ACK').toBe(true);
  }).toPass({ timeout });
}
