// Offline fixtures only. Production clients never import this file.
import { stagingBootstrap } from './staging.ts';
export const testNode = stagingBootstrap[0];

/** Handle only selection traffic so adapter tests continue to exercise their own business contracts.
 * @param url - Outgoing URL at the mocked transport boundary.
 * @param options - Actual fetch request options.
 */
export function selectionReply(url, options = {}) {
  if (!url.endsWith('/node/v1/status') && !url.endsWith('/public/v13/metadata/servers')) return null;
  if (options.headers.Authorization || options.headers['X-Testing-Api-Token']) throw new Error('Discovery leaked credentials');
  if (url.endsWith('/node/v1/status')) return Response.json({ server_load: 'normal' });
  return Response.json({ ok: true, result: { servers: { [new URL(testNode).host]: '127.0.0.1' } } });
}
