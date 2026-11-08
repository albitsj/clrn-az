import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Mitmproxy } from './mitmproxy-client';
import { startMitmdump } from './mitmproxy-process';

/** 申请本机临时监听端口并关闭探测服务，返回可用于代理的端口号。 */
async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配 mitmproxy 端口');
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

type SessionOptions = { addonPath?: string; environment?: NodeJS.ProcessEnv;
  prepare?: (directory: string, proxy: Mitmproxy) => Promise<void> };

/**
 * 测试结束或失败时先停止代理，再删除临时证书。
 * @param task - 在已准备好的上下文或代理上执行的异步任务。
 * @param options - 专用插件、进程环境和启动后的证书准备步骤；默认保持 Web 代理行为。
 */
export async function withMitmproxy<T>(task: (proxy: Mitmproxy) => Promise<T>,
  options: SessionOptions = {}): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), 'test-mitmproxy-'));
  const token = randomBytes(32).toString('hex');
  const failures: unknown[] = [];
  let result: T;
  let proxyProcess: ReturnType<typeof startMitmdump> | undefined;
  try {
    const port = await unusedPort();
    const proxy = new Mitmproxy(port, token);
    proxyProcess = startMitmdump(port, directory, token, options.addonPath, options.environment);
    await proxyProcess.waitUntilReady(() => proxy.status());
    result = await preparedTask(directory, proxy, task, options);
  } catch (error) {
    failures.push(error);
  } finally {
    await collectFailure(() => proxyProcess?.stop(), failures);
    await collectFailure(() => rm(directory, { recursive: true, force: true }), failures);
  }
  throwFailures(failures);
  return result!;
}

/** Preserve the task error followed by cleanup failures.
 * @param failures - Errors in occurrence order.
 */
function throwFailures(failures: unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    const details = failures.map(error => String(error)).join('\n');
    throw new AggregateError(failures, `mitmproxy 会话失败；按发生顺序保留原始错误和清理错误。\n${details}`,
      { cause: failures[0] });
  }
}

/** Prepare the certificate before invoking the task.
 * @param directory - Session certificate directory.
 * @param proxy - Ready proxy.
 * @param task - Caller operation.
 * @param options - Session preparation options.
 */
async function preparedTask<T>(directory: string, proxy: Mitmproxy,
  task: (proxy: Mitmproxy) => Promise<T>, options: SessionOptions): Promise<T> {
  await options.prepare?.(directory, proxy);
  return task(proxy);
}

/** Collect cleanup errors without masking earlier failures.
 * @param cleanup - One cleanup operation.
 * @param failures - Ordered shared error list.
 */
async function collectFailure(cleanup: () => Promise<void> | undefined, failures: unknown[]): Promise<void> {
  try { await cleanup(); }
  catch (error) { failures.push(error); }
}
