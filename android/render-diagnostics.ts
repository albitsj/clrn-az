/** 失败后读取应用已有渲染统计，区分应用漏帧与录屏漏帧。 */
import type { TestInfo } from '@playwright/test';
import { adb, applicationId } from './device';

/** 仅允许数字帧数据与固定统计项进入报告，不保存窗口名称或原始异常。
 * @param output - dumpsys gfxinfo framestats 输出。
 */
export function renderStatistics(output: string): object {
  const lines = output.split(/\r?\n/).map(line => line.trim());
  const summary = lines.flatMap(line => {
    const match = /^(Total frames rendered|Janky frames|Number Missed Vsync|Number Slow UI thread|Number Frame deadline missed): (\d+)/.exec(line);
    return match ? [{ metric: match[1], count: Number(match[2]) }] : [];
  });
  return { summary, frames: lines.filter(line => /^\d+(?:,-?\d+)+,?$/.test(line))
    .map(line => line.replace(/,$/, '').split(',').map(Number)) };
}

/** 不重置统计，不改变采样；设备或附件失败均不能覆盖原始测试异常。
 * @param name - 当前失败转场。
 * @param info - 当前尝试的报告。
 */
export async function preserveRenderStatistics(name: string, info: TestInfo): Promise<void> {
  if (name !== 'texas-holdem-chat-enter') return;
  try {
    const statistics = renderStatistics(adb('shell', 'dumpsys', 'gfxinfo', applicationId, 'framestats'));
    await info.attach(`${name}-render-statistics`, {
      body: JSON.stringify({ capturedAt: Date.now(), statistics }), contentType: 'application/json',
    });
  } catch { /* 诊断不能改变原始错误或包含设备异常载荷。 */ }
}
