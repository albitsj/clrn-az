import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../e2e/helpers/mitmproxy-session';
import { adb } from './device';

/**
 * 清除本轮反向转发；模拟器重连已清除监听时也视为完成。
 * @param port - 本轮代理端口。
 */
function removeReverse(port: string): void {
  try { adb('reverse', '--remove', `tcp:${port}`); }
  catch (error) {
    if (!String(error).includes(`listener 'tcp:${port}' not found`)) throw error;
  }
}

/**
 * 在专用模拟器安装本轮 CA，并只把该模拟器的流量转入隔离代理。
 * @param directory - 本轮代理的临时配置目录。
 * @param server - 主机回环地址上的代理 URL。
 */
async function configureProxy(directory: string, server: string): Promise<string | undefined> {
  if (adb('shell', 'getprop', 'ro.kernel.qemu').trim() !== '1') throw new Error('代理只能配置到专用模拟器。');
  try { adb('root'); }
  catch (error) {
    // adbd 切换为 root 会主动断开连接；仅容许该断连，并在重连后验证真实权限。
    if (!/closed|offline|device .* not found/.test(String(error))) throw error;
  }
  adb('wait-for-device');
  if (adb('shell', 'id', '-u').trim() !== '0') throw new Error('专用模拟器未成功切换 root，不能安装代理证书。');
  const certificate = path.join(directory, 'mitmproxy-ca-cert.pem');
  const hash = execFileSync('openssl', ['x509', '-in', certificate, '-subject_hash_old', '-noout'], { encoding: 'utf8' }).trim();
  if (!/^[a-f\d]{8}$/.test(hash)) throw new Error('无效代理证书 hash。');
  adb('push', certificate, `/data/local/tmp/${hash}.0`);
  adb('push', path.join(__dirname, 'trust-proxy.sh'), '/data/local/tmp/clrn-trust-proxy.sh');
  adb('shell', 'sh', '/data/local/tmp/clrn-trust-proxy.sh', `/data/local/tmp/${hash}.0`);
  const port = new URL(server).port;
  // 先从模拟器确认主机回环映射可达；不可达时改用本轮独占的反向转发。
  try {
    adb('shell', 'toybox', 'nc', '-z', '-w', '3', '10.0.2.2', port);
  } catch {
    console.log('ANDROID > 模拟器无法直连本轮代理，改用专用反向转发');
    adb('reverse', `tcp:${port}`, `tcp:${port}`);
    try { adb('shell', 'settings', 'put', 'global', 'http_proxy', `127.0.0.1:${port}`); }
    catch (error) {
      try { removeReverse(port); }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `代理设置与反向转发清理均失败：${String(error)}；${String(cleanupError)}`,
          { cause: cleanupError });
      }
      throw error;
    }
    return port;
  }
  adb('shell', 'settings', 'put', 'global', 'http_proxy', `10.0.2.2:${port}`);
  return undefined;
}

/**
 * 启动 Python 网络夹具和代理生命周期；真实认证与未声明的接口仍访问 staging。
 * @param task - 在已准备的模拟器网络环境内运行测试。
 * @param scene - 本轮 Python 场景；互斥选择页面、玩法、战绩或专项动画。
 */
export async function withAndroidProxy<T>(task: (proxy: Mitmproxy) => Promise<T>,
  scene: 'pages' | 'records' | 'texas-holdem' | 'zhajinhua' | 'matching' | 'slot' | 'skeleton' | 'invitable' = 'pages'): Promise<T> {
  let previousProxy: string | undefined;
  let reversePort: string | undefined;
  const failures: unknown[] = [];
  let result: T;
  try {
    // 上一轮连接失败后，框架重试可能早于 adbd 重连；只等待连接，不重放失败的原生命令。
    // adb() 仍限定专用模拟器并保留 120 秒上限，持续离线必须失败。
    adb('wait-for-device');
    previousProxy = adb('shell', 'settings', 'get', 'global', 'http_proxy').trim();
    result = await withMitmproxy(task, {
      addonPath: path.join(__dirname, 'proxy-addon.py'),
      environment: { ...process.env, ANDROID_SCENE: scene },
      /**
       * 将本轮临时证书和端口配置到专用模拟器。
       * @param directory - 代理临时目录。
       * @param proxy - 本轮代理连接。
       */
      prepare: async (directory, proxy) => {
        reversePort = await configureProxy(directory, proxy.server);
      },
    });
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if (previousProxy !== undefined) {
        adb('shell', 'settings', 'put', 'global', 'http_proxy', previousProxy === 'null' ? ':0' : previousProxy);
      }
    } catch (error) { failures.push(error); }
    try { if (reversePort) removeReverse(reversePort); }
    catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    // Playwright 序列化 cause，但不保存 AggregateError.errors；消息也须列出全部失败。
    const details = failures.map(error => String(error)).join('\n');
    throw new AggregateError(failures, `Android 代理会话失败；按发生顺序保留原始错误和清理错误。\n${details}`,
      { cause: failures[0] });
  }
  return result!;
}
