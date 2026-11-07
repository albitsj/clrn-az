import { NetworkError, classify, recoverable } from './errors.ts';
import { HostSelector } from './selection.ts';
import { deadline, envelope, send } from './transport.ts';
import type { ApiRequest, ApiResponse, NetworkConfig } from './types.ts';

/** Independent Node business API client with bounded, explicitly permitted recovery. */
export class NetworkClient {
  private readonly config: NetworkConfig;
  private readonly selector: HostSelector;
  private readonly lifetime = new AbortController();

  /** Configure a client; credentials belong to individual calls, never selector state.
   * @param config - Bootstrap, allowlist and bounded recovery settings.
   */
  constructor(config: NetworkConfig) {
    for (const value of [config.requestTimeoutMs ?? 15_000, config.probeTimeoutMs ?? 5_000,
      config.totalTimeoutMs ?? 45_000, config.maxAttempts ?? 3, config.cacheMs ?? 30_000,
      config.healthCacheMs ?? 10_000]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new NetworkError('configuration');
    }
    this.config = config;
    this.selector = new HostSelector(config);
  }

  /** Cancel in-flight probes/requests and clear process-local cache state. */
  dispose(): void {
    this.lifetime.abort();
    this.selector.clear();
  }

  /** Send a relative business API request and return the real service envelope.
   * @param request - Explicit endpoint replay policy and current test credentials.
   */
  async request<T>(request: ApiRequest): Promise<ApiResponse<T>> {
    validateRequest(request);
    const parent = AbortSignal.any([this.lifetime.signal, ...(request.signal ? [request.signal] : [])]);
    let attempts = 0;
    try {
      return await deadline(parent, this.config.totalTimeoutMs ?? 45_000, async signal => {
        const excluded = new Set<string>();
        while (attempts < (this.config.maxAttempts ?? 3)) {
          const host = await this.selector.select(excluded, signal);
          attempts++;
          this.selector.emit({ event: 'attempt', endpoint: request.endpoint, node: host, attempt: attempts });
          try {
            const result = await this.send<T>(host, request, signal);
            this.selector.emit({ event: 'success', endpoint: request.endpoint, node: host, attempt: attempts });
            return result;
          } catch (error) {
            const kind = signal.aborted ? classify(signal.reason) : classify(error);
            this.selector.emit({ event: 'failure', endpoint: request.endpoint, node: host, attempt: attempts, kind });
            if (recoverable(kind)) { this.selector.exclude(host); excluded.add(host); }
            if (!canReplay(request, kind, attempts, this.config.maxAttempts ?? 3) || signal.aborted) throw error;
            this.selector.emit({ event: 'switch', endpoint: request.endpoint, node: host, attempt: attempts, kind });
          }
        }
        throw new NetworkError('unavailable');
      });
    } catch (error) {
      const kind = parent.aborted ? 'cancelled' : classify(error);
      this.selector.emit({ event: 'complete', endpoint: request.endpoint, node: '', attempt: attempts, kind });
      throw new NetworkError(kind, attempts, error instanceof NetworkError ? error.status : undefined);
    }
  }

  /** Execute a single business attempt including the JSON body deadline.
   * @param host - Selected allowed origin.
   * @param request - Business request.
   * @param signal - Total call deadline.
   */
  private async send<T>(host: string, request: ApiRequest, signal: AbortSignal): Promise<ApiResponse<T>> {
    return deadline(signal, this.config.requestTimeoutMs ?? 15_000, async scoped => {
      const value = await send(this.config.fetch || globalThis.fetch, host + request.path, request.method,
        { 'Content-Type': 'application/json', ...request.headers }, request.body, scoped);
      return envelope<T>(value);
    });
  }
}

/** Require relative paths and static diagnostic templates before any network activity.
 * @param request - Untrusted runtime request configuration.
 */
function validateRequest(request: ApiRequest): void {
  if (!/^\/(?!\/)[A-Za-z0-9_/-]+$/.test(request.path) || request.path.split('/').includes('..')
    || !/^\/[A-Za-z0-9_/:{}-]+$/.test(request.endpoint)
    || !['safe', 'never'].includes(request.replay)) throw new NetworkError('configuration');
}

/** Apply replay permission independently of method names such as PUT or DELETE.
 * @param request - Endpoint policy selected by the business adapter.
 * @param kind - Classified failure.
 * @param attempts - Actual business attempts so far.
 * @param maximum - Hard attempt limit.
 */
function canReplay(request: ApiRequest, kind: Parameters<typeof recoverable>[0], attempts: number, maximum: number): boolean {
  return request.replay === 'safe' && recoverable(kind) && attempts < maximum;
}
