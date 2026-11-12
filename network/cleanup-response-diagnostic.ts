/** Preserve bounded, sanitized evidence only for a failed room deletion. */
import type { Method } from './types.ts';
import { setTimeout, clearTimeout } from 'node:timers';

type BodyEvidence = { body?: unknown; bodyKind: string; errorPage?: string };

/** Classify a complete bounded body without retaining server text.
 * @param bytes - Bounded response bytes, never logged.
 */
function decodeBody(bytes: Buffer): BodyEvidence {
  const text = bytes.toString('utf8');
  try { return { body: JSON.parse(text), bodyKind: 'json' }; }
  catch { return { bodyKind: text.trim() ? 'non-json' : 'empty', errorPage: errorPage(text) }; }
}

/** Match only fixed error-page titles; no server text or headers leave this function.
 * @param text - Complete bounded non-JSON response.
 */
function errorPage(text: string): string {
  const title = /<title>\s*([^<]*)\s*<\/title>/i.exec(text)?.[1].trim().toLowerCase();
  if (title === '500 internal server error') return '500-internal-server-error';
  if (title === 'server error (500)') return 'server-error-500';
  if (title === '502 bad gateway' || title === '504 gateway time-out') return 'gateway-error';
  return 'unrecognized';
}

/** Read at most 16 KiB without allowing diagnostics to hold up the original failure.
 * @param reader - Failed cleanup response reader, never printed verbatim.
 */
async function readBody(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<BodyEvidence> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return decodeBody(Buffer.concat(chunks));
    size += value.length;
    if (size > 16_384) return { bodyKind: 'oversized' };
    chunks.push(value);
  }
}

/** Convert untrusted JSON to fixed flags only.
 * @param body - Parsed server JSON or unavailable body.
 */
function envelopeFlags(body: unknown): object {
  const envelope = body as { ok?: unknown; error?: unknown; error_description?: unknown } | undefined;
  return { jsonBody: body !== undefined, ok: typeof envelope?.ok === 'boolean' ? envelope.ok : null,
    hasError: envelope?.error !== undefined, hasErrorDescription: envelope?.error_description !== undefined };
}

/** Release a diagnostic reader without affecting the request outcome.
 * @param reader - Reader acquired only on the failing cleanup path.
 */
function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array> | undefined): void {
  try {
    void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  } catch { /* A closed or unavailable stream cannot change the HTTP failure. */ }
}

/** Record envelope presence, never server messages, account IDs, tokens or room IDs.
 * @param response - Original HTTP error response.
 * @param url - Validated URL used only to identify the cleanup endpoint.
 * @param method - Original request method.
 */
export async function recordCleanupResponse(response: Response, url: string, method: Method): Promise<void> {
  if (method !== 'DELETE' || !/^\/v1\/room\/[0-9a-f-]{36}$/i.test(new URL(url).pathname)) return;
  let timer: NodeJS.Timeout | number | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.body?.getReader();
    const evidence: BodyEvidence = await Promise.race([reader ? readBody(reader).catch(() => ({ bodyKind: 'read-error' }))
      : { bodyKind: 'absent' }, new Promise<BodyEvidence>(resolve => {
      timer = setTimeout(() => resolve({ bodyKind: 'timeout' }), 250);
    })]);
    console.error('ROOM CLEANUP RESPONSE >', JSON.stringify({ status: response.status,
      bodyKind: evidence.bodyKind, ...(evidence.errorPage ? { errorPage: evidence.errorPage } : {}),
      ...envelopeFlags(evidence.body) }));
  } catch { /* Parsing and diagnostic output must not replace the original HTTP failure. */ }
  finally {
    clearTimeout(timer);
    releaseReader(reader);
  }
}
