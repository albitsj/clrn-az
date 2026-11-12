import type { TestInfo } from '@playwright/test';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';

/** 失败后读取已有脱敏选线记录，不发起健康探测或改变应用请求。
 * @param proxy - 当前尝试仍存活的代理。
 * @param info - 当前失败尝试的报告。
 */
export async function attachStartupNetwork(proxy: Pick<Mitmproxy, 'command'>,
  info: Pick<TestInfo, 'attach'>): Promise<void> {
  try {
    const selection = await proxy.command('android/network-selection');
    await info.attach('startup-network-selection', {
      body: JSON.stringify(selection), contentType: 'application/json',
    });
  } catch { /* 诊断失败不得替换启动失败或改变测试结果。 */ }
}
