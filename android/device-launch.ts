import { readFileSync } from 'node:fs';
import path from 'node:path';
import { _android, type AndroidDevice } from 'playwright';
import { adb, artifacts } from './device-command';
// @ts-expect-error 元数据验证模块也供纯 Node 下载入口使用。
import { applicationId, packageName, readVerifiedBuild } from './release.mjs';

/**
 * 安装已校验的 Release 并固定系统显示条件，正常冷启动应用。
 * @param options - 牌桌驱动与原生系统转场选项。
 */
export async function launchApplication(options: { gameDriver?: boolean; enableSystemAnimations?: boolean } = {}): Promise<AndroidDevice> {
  await readVerifiedBuild(artifacts);
  validateEmulator();
  configureDisplay(options.enableSystemAnimations);
  installApplication();
  if (options.gameDriver) installDriver();
  return connectDevice(options.gameDriver === true);
}

/** 验证专用模拟器、系统版本与语言。
 */
function validateEmulator(): void {
  requireProperty('ro.kernel.qemu', ['1'], '只允许在专用模拟器执行。');
  requireProperty('ro.build.version.sdk', ['35'], '截图基准要求 Android API 35。');
  if (process.env.GITHUB_ACTIONS === 'true') {
    requireProperty('ro.product.cpu.abi', ['x86_64'], 'CI 正式截图基准要求 x86_64 模拟器。');
  }
  const locale = systemLocale();
  if (!['en-US', 'en_US'].includes(locale)) throw new Error(`截图基准要求 en-US 系统语言，当前为 ${locale}。`);
}

/** 验证系统属性，不接受任意连接的手机。
 * @param property - 属性名称。
 * @param accepted - 允许的值。
 * @param message - 拒绝原因。
 */
function requireProperty(property: string, accepted: string[], message: string): void {
  if (!accepted.includes(adb('shell', 'getprop', property).trim())) throw new Error(message);
}

/** 固定显示条件及动画倍率。
 * @param enableSystemAnimations - 是否展开真实系统动画。
 */
function configureDisplay(enableSystemAnimations: boolean | undefined): void {
  adb('shell', 'wm', 'size', '720x1280');
  adb('shell', 'wm', 'density', '320');
  adb('shell', 'cmd', 'overlay', 'enable-exclusive', '--category', 'com.android.internal.systemui.navbar.gestural');
  adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
  adb('shell', 'settings', 'put', 'secure', 'spell_checker_enabled', '0');
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
  for (const setting of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) {
    // 原生 Dialog 动画短于截图调用；专用关键帧用例用系统的慢动作倍率展开真实帧。
    adb('shell', 'settings', 'put', 'global', setting, enableSystemAnimations ? '5' : '0');
  }
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  adb('shell', 'wm', 'dismiss-keyguard');
  // 系统时钟、电量和通知不属于应用视觉基准，隐藏这些变化的系统图标。
  adb('shell', 'cmd', 'statusbar', 'send-disable-flag', 'clock', 'system-icons', 'notification-icons');
}

/** 安装并核对本轮应用版本，然后正常冷启动。
 */
function installApplication(): void {
  uninstallPackage(applicationId);
  adb('install', `${artifacts}/${packageName}`);
  const information = JSON.parse(readFileSync(`${artifacts}/build-info.json`, 'utf8'));
  const installed = adb('shell', 'dumpsys', 'package', applicationId);
  if (!installed.includes(`versionName=${information.versionName}`)) throw new Error('安装后的应用版本与 Release 不一致。');
  adb('logcat', '-c');
  adb('shell', 'am', 'start', '-n', `${applicationId}/com.laiwan_react_native.MainActivity`);
}

/** 仅卸载本轮专用应用或驱动。
 * @param pkg - 已知包名。
 */
function uninstallPackage(pkg: string): void {
  if (adb('shell', 'pm', 'list', 'packages', pkg).includes(`package:${pkg}`)) adb('uninstall', pkg);
}

/** 验证固定驱动源码身份。
 * @param driver - 驱动产物目录。
 */
function verifyDriver(driver: string): void {
  const source = JSON.parse(readFileSync(path.join(driver, 'source.json'), 'utf8'));
  if (source.revision !== '39e3553a4f283a41134d75d7e404484bd9e6865a' || source.patch !== 10) throw new Error('原生动画驱动构建身份无效。');
}

/** 替换专用驱动包，保留固定构建验证。
 */
function installDriver(): void {
  const driver = path.resolve('.ttyctl/android-driver');
  verifyDriver(driver);
  for (const pkg of ['com.microsoft.playwright.androiddriver.test', 'com.microsoft.playwright.androiddriver']) uninstallPackage(pkg);
  for (const apk of ['android-driver-target.apk', 'android-driver.apk']) adb('install', path.join(driver, apk));
}

/** 连接指定模拟器，并释放其他设备连接。
 * @param omitDriverInstall - 是否使用已验证的专用驱动。
 */
async function connectDevice(omitDriverInstall: boolean): Promise<AndroidDevice> {
  const devices = await _android.devices({ omitDriverInstall });
  const device = devices.find(item => item.serial() === process.env.ANDROID_SERIAL);
  await Promise.all(devices.filter(item => item !== device).map(item => item.close()));
  if (!device) throw new Error('未找到指定模拟器。');
  device.setDefaultTimeout(30_000);
  // 此套件只操作原生控件；后台 WebView 探测的 ADB FAIL 会误关整个连接。
  // 关闭无用的浏览器发现，不重试或吞掉原生控件、截图及应用自身的错误。
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _pollingWebViews?: NodeJS.Timeout; _refreshWebViews(): Promise<void> } } })._connection.toImpl(device);
  clearTimeout(implementation._pollingWebViews);
  implementation._refreshWebViews = /** 原生测试无需发现可调试的 WebView。 */ async () => {};
  return device;
}

/** 优先使用显式系统语言，其次使用产品默认语言。
 */
function systemLocale(): string {
  return adb('shell', 'getprop', 'persist.sys.locale').trim() || adb('shell', 'getprop', 'ro.product.locale').trim();
}
