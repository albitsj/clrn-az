import type { AndroidDevice } from 'playwright';
import type { TestInfo } from '@playwright/test';
import { adb, applicationId } from '../../device';

/** 保留原有最后截图、完整控件树和运行日志的采集顺序。
 * @param device - 可能尚未启动的设备。
 * @param testInfo - 当前报告。
 */
export async function collectAuthDiagnostics(device: AndroidDevice | undefined, testInfo: TestInfo): Promise<void> {
  if (device) {
    await closeAuthDevice(device, testInfo);
    await captureAuthHierarchy(testInfo);
  }
  await captureAuthRuntime(testInfo);
}

/** 先保存末屏，再释放驱动的 UiAutomation。
 * @param device - 原生设备。
 * @param testInfo - 当前报告。
 */
async function closeAuthDevice(device: AndroidDevice, testInfo: TestInfo): Promise<void> {
  await device.screenshot()
    .then(body => testInfo.attach('last-screen', { body, contentType: 'image/png' }))
    .catch(() => undefined);
  await device.close()
    .catch(error => testInfo.attach('android-driver-close-error', { body: String(error), contentType: 'text/plain' }))
    .catch(() => undefined);
}

/** 系统树必须包含被测应用，其他窗口不可作为应用证据。
 * @param testInfo - 当前报告。
 */
async function captureAuthHierarchy(testInfo: TestInfo): Promise<void> {
  try {
    // info() 只返回单个节点；先释放测试驱动的 UiAutomation，再读取被测应用的完整控件树。
    adb('shell', 'am', 'force-stop', 'com.microsoft.playwright.androiddriver');
    adb('shell', 'uiautomator', 'dump', '/sdcard/clrn-visual-hierarchy.xml');
    const hierarchy = adb('shell', 'cat', '/sdcard/clrn-visual-hierarchy.xml');
    if (hierarchy.includes(`package="${applicationId}"`)) {
      await testInfo.attach('android-view-hierarchy', { body: hierarchy, contentType: 'application/xml' });
    } else {
      await testInfo.attach('android-view-hierarchy-error', {
        body: '页面层级中没有被测应用，不能作为应用控件树。', contentType: 'text/plain',
      });
    }
  } catch (error) {
    await testInfo.attach('android-view-hierarchy-error', { body: String(error), contentType: 'text/plain' }).catch(() => undefined);
  }
}

/** 日志采集失败作为附件保留，不掩盖原测试结果。
 * @param testInfo - 当前报告。
 */
async function captureAuthRuntime(testInfo: TestInfo): Promise<void> {
  try {
    await testInfo.attach('android-runtime', {
      body: adb('logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E'), contentType: 'text/plain',
    });
  } catch (error) {
    await testInfo.attach('android-runtime-error', { body: String(error), contentType: 'text/plain' }).catch(() => undefined);
  }
}
