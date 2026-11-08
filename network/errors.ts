import type { ErrorKind } from './types.ts';

/** Sanitized error: never retain transport causes, URLs, response bodies or credentials. */
export class NetworkError extends Error {
  readonly kind: ErrorKind;
  readonly attempts: number;
  readonly status?: number;
  /** Construct a safe error for logs and test reports.
   * @param kind - Stable classification.
   * @param attempts - Number of business requests sent.
   * @param status - Optional HTTP response status.
   */
  constructor(kind: ErrorKind, attempts = 0, status?: number) {
    super(`业务 API 请求失败 (${kind}; attempts=${attempts}${status === undefined ? '' : `; HTTP ${status}`})`);
    this.name = 'NetworkError';
    this.kind = kind;
    this.attempts = attempts;
    this.status = status;
  }
}
const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND',
  'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET']);
const timeoutCodes = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

/** Recognize Node/Undici causes without exposing their potentially sensitive messages.
 * @param error - Failure thrown by fetch or response body consumption.
 */
export function classify(error: unknown): ErrorKind {
  if (error instanceof NetworkError) return error.kind;
  let current = error;
  for (let depth = 0; current && depth < 6; depth++) {
    const item = current as { name?: string; code?: string; message?: string; cause?: unknown };
    const kind = transportKind(item);
    if (kind) return kind;
    current = item.cause;
  }
  return 'invalid-response';
}

/** Limit recovery to transport failures and server availability responses.
 * @param kind - Classified failure.
 */
export function recoverable(kind: ErrorKind): boolean {
  return ['network', 'timeout', 'server'].includes(kind);
}

/** Inspect one layer of a Node transport failure.
 * @param item - Error-like cause without copying its message into diagnostics.
 */
function transportKind(item: { name?: string; code?: string; message?: string }): ErrorKind | undefined {
  if (item.name === 'TimeoutError' || timeoutCodes.has(item.code || '')) return 'timeout';
  if (item.name === 'AbortError') return 'cancelled';
  if (networkCodes.has(item.code || '') || /\b(?:ECONNRESET|ECONNREFUSED|socket hang up|Network Error)\b/i.test(item.message || '')) return 'network';
  return undefined;
}

/** Add a safe operation stage while retaining only a sanitized cause.
 * @param error - Untrusted original failure.
 * @param stage - Static operation name.
 */
export function stageError(error: unknown, stage: string): Error {
  const cause = error instanceof NetworkError ? error : new NetworkError('invalid-response');
  return new Error(`${stage}失败：${cause.message}`, { cause });
}
