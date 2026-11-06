/** 在动画首败现场固定已有脱敏日志，避免后续场景和重试轮转掉失败窗口。 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';

/**
 * 仅复制已有 Python 诊断输出，不在录屏期间追加设备探测或改变原始测试结果。
 * @param name - 失败转场的附件前缀。
 * @param startedAt - 本次采集开始的宿主 UTC 毫秒。
 * @param testInfo - 本次尝试的独立报告。
 * @param directory - 现有采集器目录，测试使用隔离目录。
 */
export async function preserveAnimationFailure(name: string, startedAt: number, testInfo: TestInfo,
  directory = process.env.ANDROID_DIAGNOSTICS_DIR || path.join(__dirname, 'artifacts/diagnostics')): Promise<void> {
  const capturedAt = Date.now();
  const logs = [];
  for (const stream of ['logcat', 'adb', 'host', 'lifecycle']) {
    for (const suffix of ['.log.1', '.log']) {
      const file = `${stream}${suffix}`;
      try {
        const body = await readFile(path.join(directory, file));
        await testInfo.attach(`${name}-diagnostics-${file}`, { body, contentType: 'text/plain' });
        logs.push({ file, status: 'attached' });
      } catch {
        // 不复制可能含凭据的异常文本；缺失或附加失败必须在清单中可见。
        logs.push({ file, status: 'unavailable' });
      }
    }
  }
  await testInfo.attach(`${name}-diagnostics-window`, {
    body: JSON.stringify({ startedAt, capturedAt, logs }), contentType: 'application/json',
  }).catch(() => undefined);
}
