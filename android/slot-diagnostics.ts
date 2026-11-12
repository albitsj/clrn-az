import type { TestInfo } from '@playwright/test';
import { preserveAnimationFailure } from './animation-diagnostics';

/** Preserve the first failed spin window without querying the device during sampling.
 * @param name - Fixed transition name.
 * @param startedAt - Host time before the original capture.
 * @param events - Existing capture and tap timestamps.
 * @param status - Read only the isolated proxy's spin counter after failure.
 * @param info - Current attempt's report.
 */
async function preserveSlotFailure(name: string, startedAt: number,
  events: { event: string; at: number }[], status: () => Promise<{ spins: number }>, info: TestInfo): Promise<void> {
  await preserveAnimationFailure(name, startedAt, info).catch(() => undefined);
  let spins: number | null = null;
  try {
    const result = await status();
    if (Number.isSafeInteger(result.spins) && result.spins >= 0) spins = result.spins;
  } catch { /* Keep a missing counter explicit without copying proxy errors. */ }
  await info.attach(`${name}-spin-trace`, {
    body: JSON.stringify({ startedAt, capturedAt: Date.now(), events, spins }), contentType: 'application/json',
  }).catch(() => undefined);
}

/** Keep sampling and assertions intact; collect evidence only after their original failure.
 * @param name - Fixed transition name.
 * @param events - Host timestamps accumulated by the existing sampling observer.
 * @param capture - Unchanged native transition and assertions.
 * @param status - Read-only proxy counter after failure.
 * @param info - Current attempt's report.
 */
export async function withSlotDiagnostics(name: string, events: { event: string; at: number }[],
  capture: () => Promise<void>, status: () => Promise<{ spins: number }>, info: TestInfo): Promise<void> {
  const startedAt = Date.now();
  try { await capture(); }
  catch (error) {
    await preserveSlotFailure(name, startedAt, events, status, info).catch(() => undefined);
    throw error;
  }
}
