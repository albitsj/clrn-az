import { NetworkError, classify } from './errors.ts';
import { deadline, envelope, send } from './transport.ts';
import type { Diagnostic, NetworkConfig } from './types.ts';

/** Validate origins before sending any session to discovered servers.
 * @param value - Configured or discovered origin.
 * @param allowed - Environment-specific allowlist predicate.
 */
export function origin(value: string, allowed: NetworkConfig['allowOrigin']): string {
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password || !allowed(value)) throw new NetworkError('configuration');
    return url.origin;
  } catch { throw new NetworkError('configuration'); }
}

/** Bounded first-healthy selection, 30s caches and failed-node quarantine. */
export class HostSelector {
  private readonly config: NetworkConfig;
  private readonly fetcher: typeof fetch;
  private hosts: string[];
  private hostsAt = 0;
  private selected = '';
  private selectedAt = 0;
  private readonly health = new Map<string, number>();
  private readonly failed = new Map<string, number>();

  /** Initialize local bootstrap configuration without application/native dependencies.
   * @param config - Environment and transport configuration.
   */
  constructor(config: NetworkConfig) {
    this.config = config;
    this.fetcher = config.fetch || ((...args) => globalThis.fetch(...args));
    this.hosts = [...new Set(config.bootstrap.map(host => origin(host, config.allowOrigin)))];
    if (!this.hosts.length || this.hosts.length > 64) throw new NetworkError('configuration');
  }

  /** Diagnostics must never affect network results.
   * @param event - Already sanitized structured event.
   */
  emit(event: Diagnostic): void {
    try { this.config.diagnostic?.(event); } catch { /* Diagnostics are best effort. */ }
  }

  /** Remove a failed host from every cache before another selection.
   * @param host - Validated failed origin.
   */
  exclude(host: string): void {
    this.failed.set(host, Date.now());
    this.health.delete(host);
    if (this.selected === host) this.selected = '';
  }

  /** Drop in-memory caches on disposal.
   */
  clear(): void {
    this.health.clear();
    this.failed.clear();
    this.selected = '';
    this.hostsAt = 0;
  }

  /** Filter both call-local exclusions and the shared temporary quarantine.
   * @param hosts - Candidate origins.
   * @param excluded - All nodes that failed in this business call.
   */
  private available(hosts: readonly string[], excluded: Set<string>): string[] {
    const now = Date.now();
    for (const [host, at] of this.failed) if (now - at >= (this.config.cacheMs ?? 30_000)) this.failed.delete(host);
    return [...new Set(hosts)].filter(host => !excluded.has(host) && !this.failed.has(host));
  }

  /** Check health using the same server_load contract as the application.
   * @param host - Validated origin.
   * @param signal - Selection cancellation and call deadline.
   */
  private async probe(host: string, signal: AbortSignal): Promise<string> {
    if (Date.now() - (this.health.get(host) ?? 0) < (this.config.healthCacheMs ?? 10_000)) return host;
    try {
      await deadline(signal, this.config.probeTimeoutMs ?? 5_000, async scoped => {
        const body = await send(this.fetcher, `${host}/node/v1/status`, 'GET', { Accept: 'application/json' }, undefined, scoped);
        if ((body as { server_load?: string })?.server_load !== 'normal') throw new NetworkError('unavailable');
      });
      signal.throwIfAborted();
      this.health.set(host, Date.now());
      return host;
    } catch (error) {
      this.emit({ event: 'probe', endpoint: '/node/v1/status', node: host, attempt: 0, kind: classify(error) });
      throw error;
    }
  }

  /** Race at most three workers; abort losing probes and await their resource cleanup.
   * @param candidates - Allowed nodes after exclusions.
   * @param signal - Call deadline and cancellation.
   */
  private async race(candidates: string[], signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (!candidates.length) throw new NetworkError('unavailable');
    const controller = new AbortController();
    const scoped = AbortSignal.any([signal, controller.signal]);
    const pending = [...candidates].sort(() => Math.random() - 0.5);
    /** Consume the next candidate until this worker succeeds or the queue ends. */
    const worker = async () => {
      while (pending.length && !scoped.aborted) {
        const host = pending.shift()!;
        try { return await this.probe(host, scoped); } catch { /* Try the next candidate. */ }
      }
      throw new NetworkError('unavailable');
    };
    const workers = Array.from({ length: Math.min(3, candidates.length) }, worker);
    try { return await Promise.any(workers); }
    catch { signal.throwIfAborted(); throw new NetworkError('unavailable'); }
    finally { controller.abort(); await Promise.allSettled(workers); }
  }

  /** Refresh metadata without credentials, retaining candidates if no entry supplies a valid list.
   * @param preferred - Healthy bootstrap or previous selected origin.
   * @param excluded - Failed business nodes.
   * @param signal - Total call deadline.
   */
  private async discover(preferred: string, excluded: Set<string>, signal: AbortSignal): Promise<void> {
    const entries = this.available([preferred, ...this.config.bootstrap, ...this.hosts].filter(Boolean), excluded);
    for (const host of entries) {
      try {
        const value = await deadline(signal, this.config.probeTimeoutMs ?? 5_000, scoped =>
          send(this.fetcher, `${host}/public/v13/metadata/servers`, 'POST', { 'Content-Type': 'application/json' }, undefined, scoped));
        const servers = envelope<{ servers: Record<string, string> }>(value).result?.servers;
        if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new NetworkError('invalid-response');
        const hosts = Object.keys(servers).map(host => origin(`https://${host}`, this.config.allowOrigin));
        if (!hosts.length || hosts.length > 64) throw new NetworkError('invalid-response');
        this.hosts = hosts;
        this.hostsAt = Date.now();
        return;
      } catch (error) {
        signal.throwIfAborted();
        this.emit({ event: 'discovery', endpoint: '/public/v13/metadata/servers', node: host, attempt: 0, kind: classify(error) });
      }
    }
    // Metadata failure must not bypass health selection of cached or bootstrap candidates.
  }

  /** A busy bootstrap may still serve public discovery; never send business traffic without healthy selection.
   * @param excluded - Nodes already failed in this business call.
   * @param signal - Original total deadline and cancellation.
   */
  private async bootstrapHost(excluded: Set<string>, signal: AbortSignal): Promise<string> {
    try { return await this.race(this.available([...this.config.bootstrap, ...this.hosts], excluded), signal); }
    catch { signal.throwIfAborted(); return ''; }
  }

  /** Select from bootstrap then refresh remote metadata; force one refresh after exhausting a cached list.
   * @param excluded - All nodes that failed in this call.
   * @param signal - Total business-call deadline.
   */
  async select(excluded: Set<string>, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (this.available([this.selected], excluded)[0] && this.selected
      && Date.now() - this.selectedAt < (this.config.cacheMs ?? 30_000)) {
      this.emit({ event: 'cache', endpoint: 'selection', node: this.selected, attempt: 0 });
      return this.selected;
    }
    let bootstrap = '';
    if (Date.now() - this.hostsAt >= (this.config.cacheMs ?? 30_000)) {
      bootstrap = await this.bootstrapHost(excluded, signal);
      await this.discover(bootstrap, excluded, signal);
    }
    let chosen: string;
    try { chosen = await this.race(this.available(this.hosts, excluded), signal); }
    catch {
      signal.throwIfAborted();
      if (bootstrap) chosen = bootstrap;
      else {
        await this.discover('', excluded, signal);
        chosen = await this.race(this.available([...this.hosts, ...this.config.bootstrap], excluded), signal);
      }
    }
    this.selected = chosen;
    this.selectedAt = Date.now();
    this.emit({ event: 'selected', endpoint: 'selection', node: chosen, attempt: 0 });
    return chosen;
  }
}
