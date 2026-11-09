import { _android, type AndroidDevice } from 'playwright';
import type { TestInfo } from '@playwright/test';
import { adb } from './device-command';
import path from 'node:path';

/** 独立诊断分支在原比较结束后接入字体探针；不重启应用或更改页面。
 * @param original - 已完成原始比较的官方驱动。
 * @param info - 本次原始测试报告。
 */
export async function collectPasswordNativeMetrics(original: AndroidDevice, info: TestInfo): Promise<void> {
  await original.close();
  const directory = path.resolve('.ttyctl/android-driver');
  for (const pkg of ['com.microsoft.playwright.androiddriver.test', 'com.microsoft.playwright.androiddriver']) {
    adb('uninstall', pkg);
  }
  for (const apk of ['android-driver-target.apk', 'android-driver.apk']) adb('install', path.join(directory, apk));
  const devices = await _android.devices({ omitDriverInstall: true });
  const device = devices.find(item => item.serial() === process.env.ANDROID_SERIAL);
  if (!device) throw new Error('字体探针未找到本轮模拟器');
  try {
    const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
      _send(method: string): Promise<unknown>; _pollingWebViews?: NodeJS.Timeout;
      _refreshWebViews(): Promise<void> } } })._connection.toImpl(device);
    clearTimeout(implementation._pollingWebViews);
    implementation._refreshWebViews = /** 探针仅查询原生输入属性。 */ async () => {};
    const metrics = await implementation._send('inputMetrics');
    await info.attach('password-native-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' });
    await info.attach('password-native-metrics-screen', { body: await device.screenshot(), contentType: 'image/png' });
  } finally {
    await Promise.all(devices.map(item => item.close()));
  }
}
