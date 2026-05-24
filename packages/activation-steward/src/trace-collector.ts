/**
 * Trace-collection layer for @caia/activation-steward.
 *
 * Defines a pluggable {@link TraceBackend} interface and ships four
 * implementations:
 *
 * - {@link TempoBackend}  — production default. Talks Grafana Tempo's
 *                           HTTP `/api/search` endpoint with TraceQL.
 * - {@link JaegerBackend} — fallback. Talks Jaeger's HTTP `/api/traces`.
 * - {@link NullBackend}   — graceful-degradation fallback for sites that
 *                           have no telemetry pipeline yet. Always
 *                           returns `{ telemetry: 'absent' }`.
 * - {@link MockBackend}   — test double; the user constructs it with a
 *                           fixed set of `TraceMatch` records.
 *
 * Aggregation primitives ({@link aggregateBySpanName},
 * {@link aggregateByTenant}) are pure functions over `TraceMatch[]`
 * so they can be unit-tested without spinning a backend.
 */

import type {
  BackendHealth,
  TelemetryState,
  TraceMatch,
  TraceQueryOptions,
} from './types.js';

// ─── Backend contract ───────────────────────────────────────────────────────

export interface TraceBackend {
  /** Probe the backend's reachability + telemetry-pipeline state. */
  health(): Promise<BackendHealth>;
  /** Run a TraceQL-equivalent query, return normalised matches. */
  query(opts: TraceQueryOptions): Promise<ReadonlyArray<TraceMatch>>;
  /** Free-form identifier for logs. */
  readonly kind: string;
}

// ─── NullBackend (graceful degradation) ─────────────────────────────────────

/**
 * Used when the site has no telemetry pipeline. All queries succeed but
 * return an empty result set; health() always reports `absent`.
 *
 * The steward, on seeing `absent`, MUST emit `no-telemetry.warning`
 * and skip attestation rather than mark everything red.
 */
export class NullBackend implements TraceBackend {
  readonly kind = 'null';

  async health(): Promise<BackendHealth> {
    return { telemetry: 'absent', note: 'no telemetry backend configured' };
  }

  async query(_opts: TraceQueryOptions): Promise<ReadonlyArray<TraceMatch>> {
    return [];
  }
}

// ─── MockBackend (test double) ──────────────────────────────────────────────

export interface MockBackendOptions {
  readonly health?: BackendHealth;
  readonly matches?: ReadonlyArray<TraceMatch>;
  /** If set, query() throws this. Used to test degraded paths. */
  readonly queryError?: Error;
  /** If true, query() never resolves until `timeoutMs` elapses then rejects. */
  readonly simulateTimeout?: boolean;
}

export class MockBackend implements TraceBackend {
  readonly kind = 'mock';

  constructor(private readonly opts: MockBackendOptions = {}) {}

  async health(): Promise<BackendHealth> {
    return this.opts.health ?? { telemetry: 'present' };
  }

  async query(opts: TraceQueryOptions): Promise<ReadonlyArray<TraceMatch>> {
    if (this.opts.queryError) throw this.opts.queryError;
    if (this.opts.simulateTimeout) {
      await new Promise((_resolve, reject) => {
        const t = setTimeout(() => reject(new Error('query timed out')), opts.timeoutMs ?? 5000);
        t.unref?.();
      });
      return [];
    }
    const matches = this.opts.matches ?? [];
    return matches.filter((m) => filterMatch(m, opts));
  }
}

// ─── TempoBackend (production default) ──────────────────────────────────────

export interface TempoBackendOptions {
  readonly baseUrl: string; // e.g. "http://localhost:3200"
  readonly timeoutMs?: number;
  /**
   * Injected fetch — defaults to globalThis.fetch (Node 20+ has it).
   * Tests inject their own.
   */
  readonly fetch?: typeof fetch;
}

interface TempoSearchResponse {
  readonly traces?: ReadonlyArray<TempoTrace>;
}

interface TempoTrace {
  readonly traceID: string;
  readonly rootServiceName?: string;
  readonly rootSpanName?: string;
  readonly startTimeUnixNano?: string;
  readonly spanSets?: ReadonlyArray<TempoSpanSet>;
}

interface TempoSpanSet {
  readonly spans?: ReadonlyArray<TempoSpan>;
}

interface TempoSpan {
  readonly spanID: string;
  readonly startTimeUnixNano?: string;
  readonly name?: string;
  readonly attributes?: ReadonlyArray<{ readonly key: string; readonly value: TempoAttrValue }>;
}

interface TempoAttrValue {
  readonly stringValue?: string;
  readonly intValue?: number;
  readonly doubleValue?: number;
  readonly boolValue?: boolean;
}

export class TempoBackend implements TraceBackend {
  readonly kind = 'tempo';
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: TempoBackendOptions) {
    this.fetchImpl = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch!;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('TempoBackend requires a fetch implementation');
    }
  }

  async health(): Promise<BackendHealth> {
    try {
      const res = await this.fetchWithTimeout(`${this.opts.baseUrl}/ready`);
      if (res.status === 200) return { telemetry: 'present' };
      return { telemetry: 'degraded', note: `Tempo /ready returned ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Distinguish "connection refused" from "5xx": refused == absent
      // (the operator hasn't deployed Tempo yet); 5xx == degraded.
      if (
        /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)
      ) {
        return { telemetry: 'absent', note: `Tempo unreachable: ${msg}` };
      }
      return { telemetry: 'degraded', note: msg };
    }
  }

  async query(opts: TraceQueryOptions): Promise<ReadonlyArray<TraceMatch>> {
    const traceql = opts.traceql ?? this.buildTraceQL(opts);
    const url = new URL('/api/search', this.opts.baseUrl);
    url.searchParams.set('q', traceql);
    url.searchParams.set('start', String(Math.floor(opts.since.getTime() / 1000)));
    if (opts.until) {
      url.searchParams.set('end', String(Math.floor(opts.until.getTime() / 1000)));
    }

    const res = await this.fetchWithTimeout(url.toString(), opts.timeoutMs);
    if (!res.ok) {
      throw new Error(`Tempo /api/search returned ${res.status}`);
    }
    const body = (await res.json()) as TempoSearchResponse;
    return this.normalise(body, opts);
  }

  private buildTraceQL(opts: TraceQueryOptions): string {
    const clauses: string[] = [];
    if (opts.serviceName) clauses.push(`resource.service.name="${escape(opts.serviceName)}"`);
    if (opts.spanName) clauses.push(`span.name="${escape(opts.spanName)}"`);
    if (opts.tenantId) clauses.push(`span.tenant_id="${escape(opts.tenantId)}"`);
    if (clauses.length === 0) return '{}';
    return `{ ${clauses.join(' && ')} }`;
  }

  private normalise(body: TempoSearchResponse, opts: TraceQueryOptions): ReadonlyArray<TraceMatch> {
    const out: TraceMatch[] = [];
    for (const trace of body.traces ?? []) {
      for (const set of trace.spanSets ?? []) {
        for (const span of set.spans ?? []) {
          const attrs = unpackAttributes(span.attributes);
          out.push({
            serviceName: trace.rootServiceName ?? opts.serviceName ?? 'unknown',
            spanName: span.name ?? trace.rootSpanName ?? 'unknown',
            tenantId: typeof attrs.tenant_id === 'string' ? attrs.tenant_id : null,
            callpath:
              typeof attrs['solution.callpath'] === 'string'
                ? (attrs['solution.callpath'] as string)
                : null,
            traceId: trace.traceID,
            spanId: span.spanID,
            timestamp: parseUnixNano(span.startTimeUnixNano ?? trace.startTimeUnixNano),
            status: 'ok',
            attributes: attrs,
          });
        }
      }
    }
    return out;
  }

  private async fetchWithTimeout(url: string, timeoutMs?: number): Promise<Response> {
    const ms = timeoutMs ?? this.timeoutMs;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    t.unref?.();
    try {
      return await this.fetchImpl(url, { signal: ctl.signal });
    } finally {
      clearTimeout(t);
    }
  }
}

// ─── JaegerBackend (fallback) ───────────────────────────────────────────────

export interface JaegerBackendOptions {
  readonly baseUrl: string; // e.g. "http://localhost:16686"
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

interface JaegerResponse {
  readonly data?: ReadonlyArray<JaegerTrace>;
}

interface JaegerTrace {
  readonly traceID: string;
  readonly spans?: ReadonlyArray<JaegerSpan>;
  readonly processes?: Readonly<Record<string, { readonly serviceName?: string }>>;
}

interface JaegerSpan {
  readonly spanID: string;
  readonly operationName: string;
  readonly startTime: number; // microseconds since epoch
  readonly processID?: string;
  readonly tags?: ReadonlyArray<{ readonly key: string; readonly type: string; readonly value: unknown }>;
}

export class JaegerBackend implements TraceBackend {
  readonly kind = 'jaeger';
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: JaegerBackendOptions) {
    this.fetchImpl = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch!;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('JaegerBackend requires a fetch implementation');
    }
  }

  async health(): Promise<BackendHealth> {
    try {
      const res = await this.fetchWithTimeout(`${this.opts.baseUrl}/api/services`);
      if (res.status === 200) return { telemetry: 'present' };
      return { telemetry: 'degraded', note: `Jaeger /api/services returned ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(msg)) {
        return { telemetry: 'absent', note: `Jaeger unreachable: ${msg}` };
      }
      return { telemetry: 'degraded', note: msg };
    }
  }

  async query(opts: TraceQueryOptions): Promise<ReadonlyArray<TraceMatch>> {
    if (!opts.serviceName) {
      throw new Error('JaegerBackend requires opts.serviceName');
    }
    const url = new URL('/api/traces', this.opts.baseUrl);
    url.searchParams.set('service', opts.serviceName);
    if (opts.spanName) url.searchParams.set('operation', opts.spanName);
    url.searchParams.set('start', String(opts.since.getTime() * 1000));
    if (opts.until) url.searchParams.set('end', String(opts.until.getTime() * 1000));

    const res = await this.fetchWithTimeout(url.toString(), opts.timeoutMs);
    if (!res.ok) throw new Error(`Jaeger returned ${res.status}`);
    const body = (await res.json()) as JaegerResponse;
    return this.normalise(body, opts);
  }

  private normalise(body: JaegerResponse, opts: TraceQueryOptions): ReadonlyArray<TraceMatch> {
    const out: TraceMatch[] = [];
    for (const trace of body.data ?? []) {
      for (const span of trace.spans ?? []) {
        const attrs: Record<string, string | number | boolean> = {};
        for (const tag of span.tags ?? []) {
          if (typeof tag.value === 'string' || typeof tag.value === 'number' || typeof tag.value === 'boolean') {
            attrs[tag.key] = tag.value;
          }
        }
        const tenantId = typeof attrs.tenant_id === 'string' ? attrs.tenant_id : null;
        if (opts.tenantId && tenantId !== opts.tenantId) continue;
        const procService = span.processID ? trace.processes?.[span.processID]?.serviceName : undefined;
        out.push({
          serviceName: procService ?? opts.serviceName ?? 'unknown',
          spanName: span.operationName,
          tenantId,
          callpath: typeof attrs['solution.callpath'] === 'string' ? (attrs['solution.callpath'] as string) : null,
          traceId: trace.traceID,
          spanId: span.spanID,
          timestamp: new Date(Math.floor(span.startTime / 1000)),
          status: 'ok',
          attributes: attrs,
        });
      }
    }
    return out;
  }

  private async fetchWithTimeout(url: string, timeoutMs?: number): Promise<Response> {
    const ms = timeoutMs ?? this.timeoutMs;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    t.unref?.();
    try {
      return await this.fetchImpl(url, { signal: ctl.signal });
    } finally {
      clearTimeout(t);
    }
  }
}

// ─── Pure aggregation primitives ────────────────────────────────────────────

/** Aggregate matches by `(serviceName, spanName)`. */
export interface SpanAggregate {
  readonly serviceName: string;
  readonly spanName: string;
  readonly spanCount: number;
  readonly traceCount: number;
  readonly tenants: ReadonlyArray<string>;
  readonly mostRecentAt: Date | null;
}

export function aggregateBySpanName(
  matches: ReadonlyArray<TraceMatch>,
): ReadonlyArray<SpanAggregate> {
  const map = new Map<string, {
    serviceName: string;
    spanName: string;
    spans: Set<string>;
    traces: Set<string>;
    tenants: Set<string>;
    mostRecentAt: Date | null;
  }>();

  for (const m of matches) {
    const key = `${m.serviceName}::${m.spanName}`;
    let acc = map.get(key);
    if (!acc) {
      acc = {
        serviceName: m.serviceName,
        spanName: m.spanName,
        spans: new Set(),
        traces: new Set(),
        tenants: new Set(),
        mostRecentAt: null,
      };
      map.set(key, acc);
    }
    acc.spans.add(m.spanId);
    acc.traces.add(m.traceId);
    if (m.tenantId) acc.tenants.add(m.tenantId);
    if (!acc.mostRecentAt || m.timestamp > acc.mostRecentAt) {
      acc.mostRecentAt = m.timestamp;
    }
  }

  return [...map.values()].map((acc) => ({
    serviceName: acc.serviceName,
    spanName: acc.spanName,
    spanCount: acc.spans.size,
    traceCount: acc.traces.size,
    tenants: [...acc.tenants].sort(),
    mostRecentAt: acc.mostRecentAt,
  }));
}

/** Aggregate matches by tenant. */
export function aggregateByTenant(
  matches: ReadonlyArray<TraceMatch>,
): ReadonlyMap<string, ReadonlyArray<TraceMatch>> {
  const out = new Map<string, TraceMatch[]>();
  for (const m of matches) {
    const tenant = m.tenantId ?? '__no_tenant__';
    let bucket = out.get(tenant);
    if (!bucket) {
      bucket = [];
      out.set(tenant, bucket);
    }
    bucket.push(m);
  }
  return out;
}

/**
 * Probe a backend and pick the right `TelemetryState` for the run.
 * Centralises the timeout + try/catch boilerplate.
 */
export async function probeTelemetry(backend: TraceBackend, timeoutMs = 5000): Promise<TelemetryState> {
  try {
    const result = await Promise.race([
      backend.health(),
      new Promise<BackendHealth>((_, reject) => {
        const t = setTimeout(() => reject(new Error('health timed out')), timeoutMs);
        t.unref?.();
      }),
    ]);
    return result.telemetry;
  } catch {
    return 'degraded';
  }
}

// ─── Internals ──────────────────────────────────────────────────────────────

function filterMatch(m: TraceMatch, opts: TraceQueryOptions): boolean {
  if (opts.serviceName && m.serviceName !== opts.serviceName) return false;
  if (opts.spanName && m.spanName !== opts.spanName) return false;
  if (opts.tenantId && m.tenantId !== opts.tenantId) return false;
  if (m.timestamp < opts.since) return false;
  if (opts.until && m.timestamp > opts.until) return false;
  return true;
}

function escape(s: string): string {
  return s.replace(/"/g, '\\"');
}

function unpackAttributes(
  attrs: ReadonlyArray<{ readonly key: string; readonly value: TempoAttrValue }> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!attrs) return out;
  for (const a of attrs) {
    const v = a.value;
    if (v.stringValue !== undefined) out[a.key] = v.stringValue;
    else if (v.intValue !== undefined) out[a.key] = v.intValue;
    else if (v.doubleValue !== undefined) out[a.key] = v.doubleValue;
    else if (v.boolValue !== undefined) out[a.key] = v.boolValue;
  }
  return out;
}

function parseUnixNano(ns: string | undefined): Date {
  if (!ns) return new Date(0);
  // Tempo returns nanoseconds-since-epoch as a string. Drop last 6 digits
  // to convert to milliseconds; precision loss is fine for our windowing.
  const ms = Number(ns.length > 6 ? ns.slice(0, -6) : ns);
  return new Date(Number.isFinite(ms) ? ms : 0);
}
