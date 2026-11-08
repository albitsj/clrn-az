import { NetworkClient } from './client.ts';
import { NetworkError, classify } from './errors.ts';
import { deadline, envelope, send } from './transport.ts';
import type { ApiResponse, Json, Method } from './types.ts';

export const stagingOrigin = 'https://api.shafayouxi.org';
// laiwan_react_native b20853dbe65c5025d7232b17ea99e9a5d9a1a3ec, top_servers_staging.json.
export const stagingBootstrap = [
  'https://64.kr-seoul.api.staging.laiwan.shafayouxi.com',
  'https://65.jp-tokyo.api.staging.laiwan.shafayouxi.com',
  'https://68.kr.api.staging.laiwan.shafayouxi.com',
  'https://67.hk-sn.api.staging.laiwan.shafayouxi.com',
];

/** Only staging regional nodes may receive real account credentials.
 * @param value - Candidate origin.
 */
function allowed(value: string): boolean {
  return /^https:\/\/[a-z0-9.-]+\.api\.staging\.laiwan\.shafayouxi\.com$/.test(value);
}

/** Create an explicit per-test/account lifecycle. No APK connection or token is reused. */
export function createStagingClient(): NetworkClient {
  return new NetworkClient({ bootstrap: stagingBootstrap, allowOrigin: allowed,
    /** Write only the structured sanitized event.
     * @param event - Safe network diagnostic.
     */
    diagnostic: event => console.error('BUSINESS NETWORK >', JSON.stringify(event)) });
}

/** Fixed test-management boundary: one attempt, no discovery, no redirects or regional token forwarding.
 * @param path - Strictly constrained test management path.
 * @param body - Currency and absolute balance.
 * @param token - Testing token, sent only to the fixed staging origin.
 */
export async function setTestingBalance<T>(path: string, body: Json, token: string): Promise<ApiResponse<T>> {
  if (!/^\/public\/v1\/wallet\/[0-9a-f-]{36}\/set_balance\/testing$/i.test(path) || typeof token !== 'string' || !token.trim()) {
    throw new NetworkError('configuration');
  }
  try {
    return await deadline(new AbortController().signal, 15_000, async signal =>
      envelope<T>(await send(globalThis.fetch, stagingOrigin + path, 'POST',
        { 'Content-Type': 'application/json', 'X-Testing-Api-Token': token }, body, signal)));
  } catch (error) {
    throw new NetworkError(classify(error), 1, error instanceof NetworkError ? error.status : undefined);
  }
}

type Endpoint = { pattern: RegExp; method: Method; template: string; replay: 'safe' | 'never' };
const id = '[0-9a-f-]{36}';
const endpoints: Endpoint[] = [
  { pattern: new RegExp(`^/v10/wallet/${id}$`, 'i'), method: 'PUT', template: '/v10/wallet/:userId', replay: 'safe' },
  // This apparent query is get-or-create on the server; no automatic replay.
  { pattern: new RegExp(`^/v10/house/user/${id}$`, 'i'), method: 'PUT', template: '/v10/house/user/:userId', replay: 'never' },
  { pattern: /^\/v2\/building\/rooms$/, method: 'PUT', template: '/v2/building/rooms', replay: 'safe' },
  { pattern: new RegExp(`^/v1/room/${id}$`, 'i'), method: 'GET', template: '/v1/room/:roomId', replay: 'safe' },
  // Deletion can trigger settlement/refund: no blind replay after an ambiguous response loss.
  { pattern: new RegExp(`^/v1/room/${id}$`, 'i'), method: 'DELETE', template: '/v1/room/:roomId', replay: 'never' },
  { pattern: /^\/public\/v10\/user\/login\/username\/password$/, method: 'POST',
    template: '/public/v10/user/login/username/password', replay: 'never' },
  // Plain enter renews membership/session and emits an enter notification; it cannot create, buy in or sit.
  { pattern: new RegExp(`^/v10/texas_holdem/room/${id}/enter$`, 'i'), method: 'PUT',
    template: '/v10/texas_holdem/room/:roomId/enter', replay: 'safe' },
];

/** Reviewed business endpoints only; unknown writes cannot opt themselves into automatic replay.
 * @param client - Caller-owned independent network client.
 * @param path - Relative business path.
 * @param method - Method with reviewed semantics.
 * @param body - Optional request data.
 * @param authorization - Current account token, absent only for login.
 */
export function businessRequest<T>(client: NetworkClient, path: string, method: Method,
  body?: Json, authorization?: string): Promise<ApiResponse<T>> {
  const endpoint = endpoints.find(item => item.method === method && item.pattern.test(path));
  if (!endpoint) throw new NetworkError('configuration');
  return client.request<T>({ path, method, body, endpoint: endpoint.template, replay: endpoint.replay,
    headers: authorization ? { Authorization: authorization } : {} });
}
