import type { TestInfo } from '@playwright/test';
import { adb } from './device-command';

/** 启动失败后只读核对当前模拟器代理与路由；不重配网络、不请求上游。
 * @param info - 原始失败所属的报告。
 */
export async function preserveProxyTransport(info: TestInfo): Promise<void> {
  const proxy = readTransport('settings', 'get', 'global', 'http_proxy');
  const routes = readTransport('ip', 'route', 'show');
  const endpoint = /^(10\.0\.2\.2|127\.0\.0\.1):(\d{1,5})$/.exec(proxy.output.trim());
  const probe = probeProxy(endpoint);
  await info.attach('launch-proxy-transport', {
    body: JSON.stringify({ at: Date.now(), proxyReadable: proxy.ok, endpoint: endpoint?.[1],
      routesReadable: routes.ok, defaultRoute: /^default\s/m.test(routes.output),
      wifiRoute: /\bdev wlan0\b/.test(routes.output), proxyReachable: probe }),
    contentType: 'application/json',
  }).catch(() => undefined);
}

/** 固定的只读设备命令失败仅保留状态，异常文本不进入新增附件。
 * @param args - 内部固定命令参数。
 */
function readTransport(...args: string[]): { ok: boolean; output: string } {
  try { return { ok: true, output: adb('shell', ...args) }; }
  catch { return { ok: false, output: '' }; }
}

/** 仅探测当前已配置的两个专用代理地址，保持 nc 原有三秒上限。
 * @param endpoint - 已限制的模拟器代理地址和端口。
 */
function probeProxy(endpoint: RegExpExecArray | null): boolean | null {
  if (!endpoint) return null;
  return readTransport('toybox', 'nc', '-z', '-w', '3', endpoint[1], endpoint[2]).ok;
}
