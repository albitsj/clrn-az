import { NetworkError, classify } from './errors.ts';
import type { ApiResponse, Json, Method } from './types.ts';
import { recordCleanupResponse } from './cleanup-response-diagnostic.ts';

/** Run a whole operation under a cancellable deadline, clearing its timer on every exit.
 * @param parent - Caller or client lifetime signal.
 * @param timeoutMs - Deadline including response body reads.
 * @param action - Work that must honor the composed signal.
 */
export async function deadline<T>(parent: AbortSignal, timeoutMs: number,
  action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('Deadline', 'TimeoutError')), timeoutMs);
  try { return await action(AbortSignal.any([parent, timeout.signal])); }
  finally { clearTimeout(timer); }
}

/** Parse JSON while preserving transport failures during streaming.
 * @param response - Real HTTP response.
 * @param signal - Entire request deadline.
 */
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  try { return await response.json(); }
  catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new NetworkError(classify(error));
  }
}

/** HTTP boundary shared by discovery, health probes and business calls.
 * @param fetcher - Node fetch or an offline adapter boundary.
 * @param url - Validated origin and relative path.
 * @param method - HTTP method.
 * @param headers - Explicit request headers.
 * @param body - Optional JSON payload.
 * @param signal - Request deadline and cancellation.
 */
export async function send(fetcher: typeof fetch, url: string, method: Method,
  headers: Record<string, string>, body: Json | undefined, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetcher(url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal,
  });
  try {
    if (response.status === 401 || response.status === 403) throw new NetworkError('auth', 0, response.status);
    if (response.status >= 500) {
      const error = new NetworkError('server', 0, response.status);
      await recordCleanupResponse(response, url, method);
      throw error;
    }
    if (!response.ok) throw new NetworkError('http', 0, response.status);
    return await json(response, signal);
  } finally {
    // Error responses may still have a live body; success JSON has already consumed it.
    if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => undefined);
  }
}

/** Require the service's actual success envelope; business rejection never switches nodes.
 * @param value - Parsed service response.
 */
export function envelope<T>(value: unknown): ApiResponse<T> {
  const data = value as ApiResponse<T>;
  if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') throw new NetworkError('invalid-response');
  if (!data.ok) throw new NetworkError('business');
  return data;
}
