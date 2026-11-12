/** Preserve bounded, sanitized evidence only for a failed room deletion. */
import type { Method } from './types.ts';
import { setTimeout, clearTimeout } from 'node:timers';

/** Read at most 16 KiB without allowing diagnostics to hold up the original failure.
 * @param reader - Failed cleanup response reader, never printed verbatim.
 */
async function readBody(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    size += value.length;
    if (size > 16_384) return undefined;
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
    const body = await Promise.race([reader ? readBody(reader).catch(() => undefined) : undefined, new Promise<undefined>(resolve => {
      timer = setTimeout(resolve, 250);
    })]);
    console.error('ROOM CLEANUP RESPONSE >', JSON.stringify({ status: response.status, ...envelopeFlags(body) }));
  } catch { /* Parsing and diagnostic output must not replace the original HTTP failure. */ }
  finally {
    clearTimeout(timer);
    releaseReader(reader);
  }
}
