import { NetworkError, classify } from './errors.ts';
import type { ApiResponse, Json, Method } from './types.ts';

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
 * @param roomCleanup - Enable diagnostics only for the room deletion boundary.
 */
async function json(response: Response, signal: AbortSignal, roomCleanup: boolean): Promise<unknown> {
  try { return await response.json(); }
  catch (error) {
    if (roomCleanup) cleanupDiagnostic(error, 'body');
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
  const roomCleanup = isRoomCleanup(url, method);
  let response: Response;
  try {
    response = await fetcher(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal,
    });
  } catch (error) {
    if (roomCleanup) cleanupDiagnostic(error, 'headers');
    throw error;
  }
  try {
    if (response.status === 401 || response.status === 403) throw new NetworkError('auth', 0, response.status);
    if (response.status >= 500) throw new NetworkError('server', 0, response.status);
    if (!response.ok) throw new NetworkError('http', 0, response.status);
    return await json(response, signal, roomCleanup);
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

/** Record only fixed transport codes; diagnostic failures must preserve the original failure.
 * @param error - Untrusted fetch or body error, never serialized.
 * @param phase - Whether response headers had already arrived.
 */
function cleanupDiagnostic(error: unknown, phase: 'headers' | 'body'): void {
  try {
    const codes: string[] = [];
    let current = error;
    for (let depth = 0; current && depth < 6; depth++) {
      const item = current as { code?: unknown; cause?: unknown };
      if (typeof item.code === 'string' && /^(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(item.code)) {
        codes.push(item.code);
      }
      current = item.cause;
    }
    console.error('ROOM CLEANUP TRANSPORT >', JSON.stringify({ phase, kind: classify(error), codes }));
  } catch { /* Diagnostics cannot replace the request failure. */ }
}

/** Limit additional evidence to the failed deletion endpoint.
 * @param url - Validated request URL, never logged.
 * @param method - Existing request method.
 */
function isRoomCleanup(url: string, method: Method): boolean {
  return method === 'DELETE' && /^\/v1\/room\/[0-9a-f-]{36}$/i.test(new URL(url).pathname);
}
