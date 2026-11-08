import { expect } from '@playwright/test';
import { setTimeout } from 'node:timers/promises';
import type { AndroidDevice } from 'playwright';

export type ChallengeFrame = { capturedAt: number; original: Buffer };

/** 连续采集真实屏幕位图后再编码，复用固定驱动已有协议。
 * @param device - 当前专用模拟器，不能替换应用画面或动画时钟。
 */
export async function challengeFrames(device: AndroidDevice): Promise<ChallengeFrame[]> {
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<{ capturedAt: number; png: string }[]>
  } } })._connection.toImpl(device);
  const timeout = new AbortController();
  try {
    const frames = await Promise.race([
      implementation._send('motionFrames'),
      setTimeout(30_000, undefined, { signal: timeout.signal }).then(() => { throw new Error('比牌原生连续采样超时。'); }),
    ]);
    expect(frames.length, '比牌原生采样至少返回三帧').toBeGreaterThanOrEqual(3);
    return frames.map(frame => ({ capturedAt: frame.capturedAt, original: Buffer.from(frame.png, 'base64') }));
  } finally { timeout.abort(); }
}
