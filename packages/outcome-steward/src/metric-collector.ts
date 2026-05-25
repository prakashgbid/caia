/**
 * Metric-collection layer for @caia/outcome-steward.
 *
 * Defines a pluggable {@link MetricBackend} interface and ships four
 * implementations:
 *
 * - {@link PrometheusBackend} — production default. Talks Prometheus
 *                               HTTP `/api/v1/query_range`.
 * - {@link GrafanaBackend}    — fallback. Talks Grafana datasource-proxy
 *                               `/api/datasources/proxy/uid/<uid>/api/v1/query_range`.
 * - {@link NullBackend}       — graceful-degradation fallback for sites
 *                               with no metrics pipeline yet. Always
 *                               returns `{ backend: 'absent' }`.
 * - {@link MockBackend}       — test double; user constructs it with a
 *                               fixed map of `query → MetricSeries`.
 *
 * Pure helpers ({@link computeSlope}, {@link compareThreshold},
 * {@link defaultStepSeconds}, {@link pickMostRecent}, {@link probeBackend})
 * are exported for unit-testability and for reuse by the cross-checker.
 */

import type {
  BackendHealth,
  BackendState,
  MetricQueryOptions,
  MetricSample,
  MetricSeries,
  ThresholdDirection,
  TrendDirection,
  TrendResult,
} from './types.js';

// ─── Backend contract ───────────────────────────────────────────────────────

export interface MetricBackend {
  /** Probe the backend's reachability + state. */
  health(): Promise<BackendHealth>;
  /** Run a PromQL-equivalent query, return normalised series. */
  query(opts: MetricQueryOptions): Promise<MetricSeries>;
  /** Free-form identifier for logs. */
  readonly kind: string;
}

const EPSILON = 1e-9;

// ─── NullBackend (graceful degradation) ─────────────────────────────────────

/**
 * Used when the site has no metric backend deployed. All queries return
 * an empty series; health() always reports `absent`.
 *
 * The steward, on seeing `absent`, MUST emit `no-metric-store.warning`
 * and skip attestation rather than mark everything red.
 */
export class NullBackend implements MetricBackend {
  readonly kind = 'null';

  async health(): Promise<BackendHealth> {
    return { backend: 'absent', note: 'no metric backend configured' };
  }

  async query(opts: MetricQueryOptions): Promise<MetricSeries> {
    return {
      query: opts.query,
      metric: null,
      samples: [],
      labels: {},
    };
  }
}

// ─── MockBackend (test double) ──────────────────────────────────────────────

export interface MockBackendOptions {
  readonly health?: BackendHealth;
  /** Per-query response. The exact `opts.query` string is the lookup key. */
  readonly series?: ReadonlyMap<string, MetricSeries>;
  /** If set, query() throws this. Used to test degraded paths. */
  readonly queryError?: Error;
  /** If true, query() never resolves until `timeoutMs` elapses then rejects. */
  readonly simulateTimeout?: boolean;
}

export class MockBackend implements MetricBackend {
  readonly kind = 'mock';

  constructor(private readonly opts: MockBackendOptions = {}) {}

  async health(): Promise<BackendHealth> {
    return this.opts.health ?? { backend: 'present' };
  }

  async query(opts: MetricQueryOptions): Promise<MetricSeries> {
    if (this.opts.queryError) throw this.opts.queryError;
    if (this.opts.simulateTimeout) {
      await new Promise((_resolve, reject) => {
        const t = setTimeout(() => reject(new Error('query timed out')), opts.timeoutMs ?? 5000);
        t.unref?.();
      });
    }
    const hit = this.opts.series?.get(opts.query);
    if (hit) return hit;
    return {
      query: opts.query,
      metric: null,
      samples: [],
      labels: {},
    };
  }
}

// ─── PrometheusBackend (production default) ─────────────────────────────────

export interface PrometheusBackendOptions {
  readonly baseUrl: string; // e.g. "http://localhost:9090"
  readonly timeoutMs?: number;
  /** Injected fetch — defaults to globalThis.fetch (Node 20+ has it). */
  readonly fetch?: typeof fetch;
}

interface PromRangeResponse {
  readonly status: 'success' | 'error';
  readonly error?: string;
  readonly errorType?: string;
  readonly data?: {
    readonly resultType: string;
    readonly result?: ReadonlyArray<PromRangeResult>;
  };
}

interface PromRangeResult {
  readonly metric?: Readonly<Record<string, string>>;
  readonly values?: ReadonlyArray<readonly [number, string]>;
}

export class PrometheusBackend implements MetricBackend {
  readonly kind = 'prometheus';
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: PrometheusBackendOptions) {
    this.fetchImpl = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch!;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('PrometheusBackend requires a fetch implementation');
    }
  }

  async health(): Promise<BackendHealth> {
    try {
      const res = await this.fetchWithTimeout(`${this.opts.baseUrl}/-/ready`);
      if (res.status === 200) return { backend: 'present' };
      return { backend: 'degraded', note: `Prometheus /-/ready returned ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)) {
        return { backend: 'absent', note: `Prometheus unreachable: ${msg}` };
      }
      return { backend: 'degraded', note: msg };
    }
  }

  async query(opts: MetricQueryOptions): Promise<MetricSeries> {
    const until = opts.until ?? new Date();
    const step = opts.stepSeconds ?? defaultStepSeconds(opts.since, until);
    const url = new URL('/api/v1/query_range', this.opts.baseUrl);
    url.searchParams.set('query', opts.query);
    url.searchParams.set('start', String(Math.floor(opts.since.getTime() / 1000)));
    url.searchParams.set('end', String(Math.floor(until.getTime() / 1000)));
    url.searchParams.set('step', String(step));

    const res = await this.fetchWithTimeout(url.toString(), opts.timeoutMs);
    if (!res.ok) {
      throw new Error(`Prometheus /api/v1/query_range returned ${res.status}`);
    }
    const body = (await res.json()) as PromRangeResponse;
    if (body.status !== 'success') {
      throw new Error(`Prometheus query failed: ${body.error ?? body.errorType ?? 'unknown'}`);
    }
    return normalisePromResult(opts.query, body.data?.result ?? []);
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

// ─── GrafanaBackend (datasource-proxy fallback) ─────────────────────────────

export interface GrafanaBackendOptions {
  readonly baseUrl: string; // e.g. "https://grafana.example.com"
  readonly datasourceUid: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export class GrafanaBackend implements MetricBackend {
  readonly kind = 'grafana';
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: GrafanaBackendOptions) {
    this.fetchImpl = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch!;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('GrafanaBackend requires a fetch implementation');
    }
  }

  async health(): Promise<BackendHealth> {
    try {
      const res = await this.fetchWithTimeout(`${this.opts.baseUrl}/api/health`);
      if (res.status === 200) return { backend: 'present' };
      return { backend: 'degraded', note: `Grafana /api/health returned ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)) {
        return { backend: 'absent', note: `Grafana unreachable: ${msg}` };
      }
      return { backend: 'degraded', note: msg };
    }
  }

  async query(opts: MetricQueryOptions): Promise<MetricSeries> {
    const until = opts.until ?? new Date();
    const step = opts.stepSeconds ?? defaultStepSeconds(opts.since, until);
    const url = new URL(
      `/api/datasources/proxy/uid/${encodeURIComponent(this.opts.datasourceUid)}/api/v1/query_range`,
      this.opts.baseUrl,
    );
    url.searchParams.set('query', opts.query);
    url.searchParams.set('start', String(Math.floor(opts.since.getTime() / 1000)));
    url.searchParams.set('end', String(Math.floor(until.getTime() / 1000)));
    url.searchParams.set('step', String(step));

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.opts.apiKey) {
      headers.Authorization = `Bearer ${this.opts.apiKey}`;
    }

    const res = await this.fetchWithTimeout(url.toString(), opts.timeoutMs, headers);
    if (!res.ok) {
      throw new Error(`Grafana proxy returned ${res.status}`);
    }
    const body = (await res.json()) as PromRangeResponse;
    if (body.status !== 'success') {
      throw new Error(`Grafana proxy query failed: ${body.error ?? body.errorType ?? 'unknown'}`);
    }
    return normalisePromResult(opts.query, body.data?.result ?? []);
  }

  private async fetchWithTimeout(
    url: string,
    timeoutMs?: number,
    headers?: Record<string, string>,
  ): Promise<Response> {
    const ms = timeoutMs ?? this.timeoutMs;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    t.unref?.();
    try {
      return await this.fetchImpl(url, {
        signal: ctl.signal,
        ...(headers ? { headers } : {}),
      });
    } finally {
      clearTimeout(t);
    }
  }
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Linear-regression slope over `[t_seconds, value]` samples, returned
 * as **units per hour** (so the unit matches the typical SLO time-base
 * even when Prometheus reports unix seconds).
 *
 * Returns `null` when there are fewer than 2 samples (slope undefined).
 */
export function computeSlope(samples: ReadonlyArray<MetricSample>): number | null {
  if (samples.length < 2) return null;
  const n = samples.length;
  let sumT = 0;
  let sumV = 0;
  let sumTT = 0;
  let sumTV = 0;
  for (const [t, v] of samples) {
    sumT += t;
    sumV += v;
    sumTT += t * t;
    sumTV += t * v;
  }
  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < EPSILON) return 0;
  const slopePerSecond = (n * sumTV - sumT * sumV) / denom;
  return slopePerSecond * 3600;
}

/**
 * Threshold compare. Returns true iff `value` satisfies `direction op
 * threshold`. Uses an absolute epsilon for `eq` / `neq`.
 */
export function compareThreshold(
  value: number,
  direction: ThresholdDirection,
  threshold: number,
): boolean {
  switch (direction) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'eq':
      return Math.abs(value - threshold) < EPSILON;
    case 'neq':
      return Math.abs(value - threshold) >= EPSILON;
  }
}

/**
 * Classify a slope per the expected trend direction.
 * `slopePerHour > 0` → 'up', `< 0` → 'down', within an epsilon → 'flat'.
 * Returns 'unknown' for null slopes (insufficient samples).
 */
export function classifyTrend(
  slopePerHour: number | null,
  flatEpsilon = 1e-6,
): TrendResult {
  if (slopePerHour === null) return 'unknown';
  if (Math.abs(slopePerHour) < flatEpsilon) return 'flat';
  return slopePerHour > 0 ? 'up' : 'down';
}

/**
 * Does the observed trend satisfy the expected trend direction?
 *
 * `'any'` accepts everything (including 'unknown' — i.e. no trend gate).
 * `'flat'` accepts only 'flat' (a hard stability requirement).
 * `'up'` / `'down'` require the matching direction; 'unknown' fails.
 */
export function trendSatisfied(
  expected: TrendDirection,
  observed: TrendResult,
): boolean {
  if (expected === 'any') return true;
  if (observed === 'unknown') return false;
  return expected === observed;
}

/**
 * Compute a sensible Prometheus step (seconds) so the range query yields
 * roughly 60 points across the window.
 */
export function defaultStepSeconds(since: Date, until: Date): number {
  const windowSeconds = Math.max(60, Math.floor((until.getTime() - since.getTime()) / 1000));
  const step = Math.max(15, Math.floor(windowSeconds / 60));
  return step;
}

/**
 * The most recent sample in the series, or null if empty.
 */
export function pickMostRecent(series: MetricSeries): MetricSample | null {
  if (series.samples.length === 0) return null;
  // samples are sorted ascending; return last.
  return series.samples[series.samples.length - 1] ?? null;
}

/**
 * Probe a backend and pick the right `BackendState` for the run.
 * Centralises the timeout + try/catch boilerplate.
 */
export async function probeBackend(
  backend: MetricBackend,
  timeoutMs = 5000,
): Promise<BackendState> {
  try {
    const result = await Promise.race([
      backend.health(),
      new Promise<BackendHealth>((_, reject) => {
        const t = setTimeout(() => reject(new Error('health timed out')), timeoutMs);
        t.unref?.();
      }),
    ]);
    return result.backend;
  } catch {
    return 'degraded';
  }
}

// ─── Internals ──────────────────────────────────────────────────────────────

function normalisePromResult(
  query: string,
  result: ReadonlyArray<PromRangeResult>,
): MetricSeries {
  if (result.length === 0) {
    return { query, metric: null, samples: [], labels: {} };
  }
  // Use the first result vector (a SLI is expected to evaluate to a
  // single series; multi-series results are folded by taking the first).
  const first = result[0]!;
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(first.metric ?? {})) {
    if (typeof v === 'string') labels[k] = v;
  }
  const metric = labels.__name__ ?? null;
  const samples: MetricSample[] = [];
  for (const [t, raw] of first.values ?? []) {
    const v = Number(raw);
    if (Number.isFinite(v)) samples.push([t, v] as const);
  }
  // Already ascending per Prom contract, but sort defensively.
  samples.sort((a, b) => a[0] - b[0]);
  return { query, metric, samples, labels };
}
