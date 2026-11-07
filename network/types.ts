/** JSON values accepted by the Node transport. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ErrorKind = 'network' | 'timeout' | 'cancelled' | 'auth' | 'business'
  | 'invalid-response' | 'http' | 'server' | 'unavailable' | 'configuration';
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Replay = 'safe' | 'never';
export type Diagnostic = {
  event: 'complete' | 'attempt' | 'failure' | 'switch' | 'success' | 'probe' | 'selected' | 'cache' | 'discovery';
  endpoint: string;
  node: string;
  attempt: number;
  kind?: ErrorKind;
};
export type NetworkConfig = {
  bootstrap: readonly string[];
  allowOrigin: (origin: string) => boolean;
  fetch?: typeof globalThis.fetch;
  diagnostic?: (event: Diagnostic) => void;
  requestTimeoutMs?: number;
  probeTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxAttempts?: number;
  cacheMs?: number;
  healthCacheMs?: number;
};
export type ApiRequest = {
  path: string;
  /** A static template, without user IDs or query values. */
  endpoint: string;
  method: Method;
  replay: Replay;
  headers?: Record<string, string>;
  body?: Json;
  signal?: AbortSignal;
};
export type ApiResponse<T> = { ok: true; result: T };
