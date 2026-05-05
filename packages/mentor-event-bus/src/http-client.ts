/**
 * HTTP client for cross-machine event emission.
 *
 * Used when the producer is on a different machine from where Mentor's
 * SQLite lives. Producer calls `httpEmit(...)` which POSTs the event to
 * `<server>/v1/events` with HMAC headers (see `auth.ts`).
 *
 * Phase 0 invariant: never throw on transient failure. The `httpEmit`
 * function returns a result discriminated union — caller can persist to
 * a fallback buffer if it wants reliability. The Phase-0 producer
 * (poll-loop, memory-watcher) just logs the warning and moves on; future
 * Mentor-Phase-1 work will add a local on-disk retry buffer.
 */

import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hostname as osHostname } from 'node:os';

import { signRequest } from './auth.js';
import { describeSchema, EVENT_SCHEMAS, validatePayload } from './schemas.js';
import { EVENT_TYPES, type EventType, type PayloadOf } from './types.js';
import { currentCorrelationId, currentParentEventId } from './correlation.js';

export interface HttpClientOptions {
  /** Base URL, e.g. http://mac.tailscale-ip:5180 */
  baseUrl: string;
  /** Shared HMAC secret. */
  secret: string;
  /** Hostname to record on emitted events. Default: os.hostname(). */
  hostname?: string;
  /** Process name. */
  processName?: string;
  /** Logger. */
  logger?: { warn: (m: string, ctx?: unknown) => void };
  /** Per-request timeout (ms). Default 5000. */
  timeoutMs?: number;
  /** Override the `now()` clock (for tests). */
  now?: () => number;
}

export interface HttpEmitOptions {
  correlationId?: string;
  parentEventId?: string;
  schemaVersion?: number;
  emittedAt?: Date;
}

export type HttpEmitResult =
  | { ok: true; status: number; ingestOffsets: number[] }
  | { ok: false; status?: number; error: string };

const consoleLogger = {
  warn: (m: string, ctx?: unknown): void => {
    if (ctx !== undefined) console.warn(m, ctx);
    else console.warn(m);
  }
};

/**
 * HTTP-emit one or more events.
 *
 * Single-event convenience:
 *   await httpEmit(client, 'PRMerged', { prNumber: 1, sha: 'a', branch: 'main' })
 */
export class HttpClient {
  private readonly baseUrl: URL;
  private readonly secret: string;
  private readonly hostname: string;
  private readonly processName: string | null;
  private readonly logger: { warn: (m: string, ctx?: unknown) => void };
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(opts: HttpClientOptions) {
    if (!opts.baseUrl) throw new Error('HttpClient: baseUrl is required');
    if (!opts.secret) throw new Error('HttpClient: secret is required');
    this.baseUrl = new URL(opts.baseUrl);
    this.secret = opts.secret;
    this.hostname = opts.hostname ?? osHostname();
    this.processName = opts.processName ?? null;
    this.logger = opts.logger ?? consoleLogger;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Single-event emit. Validates locally + POSTs to `/v1/events`.
   * Never throws — returns a discriminated result.
   */
  async emit<T extends EventType>(
    type: T,
    payload: PayloadOf<T>,
    opts: HttpEmitOptions = {}
  ): Promise<HttpEmitResult> {
    const v = validatePayload(type, payload);
    let validation_failed: 0 | 1 = 0;
    if (!v.ok) {
      this.logger.warn(`[mentor-event-bus.http] validation failed for ${type}`, v.error.issues);
      validation_failed = 1;
    }
    let payload_json: string;
    try {
      payload_json = JSON.stringify(payload);
    } catch (err) {
      return { ok: false, error: `payload-stringify-failed: ${String(err)}` };
    }

    const correlation_id = opts.correlationId ?? currentCorrelationId() ?? null;
    const parent_event_id = opts.parentEventId ?? currentParentEventId() ?? null;
    const emitted_at = (opts.emittedAt ?? new Date()).toISOString();
    const schema_version = opts.schemaVersion ?? 1;

    const event = {
      event_type: type,
      schema_version,
      correlation_id,
      parent_event_id,
      emitted_at,
      hostname: this.hostname,
      process_name: this.processName,
      payload_json,
      validation_failed
    };

    return this.postEvents([event]);
  }

  /**
   * Batch-emit. Useful for the future fallback-buffer drain.
   */
  postEvents(events: Array<Record<string, unknown>>): Promise<HttpEmitResult> {
    const body = JSON.stringify({ events });
    return this.post('/v1/events', body);
  }

  /**
   * Healthcheck. Returns the response body string ("ok\n") if reachable.
   */
  async healthz(): Promise<{ ok: boolean; body?: string; error?: string }> {
    return new Promise((resolve) => {
      const req = this.makeRequest(
        'GET',
        '/v1/healthz',
        undefined,
        (status, body) => {
          if (status === 200) resolve({ ok: true, body });
          else resolve({ ok: false, error: `http ${status}` });
        },
        (err) => resolve({ ok: false, error: err })
      );
      req.end();
    });
  }

  private post(path: string, body: string): Promise<HttpEmitResult> {
    return new Promise((resolve) => {
      const sigHeaders = signRequest(this.secret, body, this.now());
      const req = this.makeRequest(
        'POST',
        path,
        {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body).toString(),
          ...sigHeaders
        },
        (status, respBody) => {
          if (status >= 200 && status < 300) {
            try {
              const parsed = JSON.parse(respBody) as { offsets?: number[] };
              resolve({
                ok: true,
                status,
                ingestOffsets: Array.isArray(parsed.offsets) ? parsed.offsets : []
              });
            } catch {
              resolve({ ok: true, status, ingestOffsets: [] });
            }
          } else {
            resolve({ ok: false, status, error: `http ${status}: ${respBody.slice(0, 200)}` });
          }
        },
        (err) => resolve({ ok: false, error: err })
      );
      req.write(body);
      req.end();
    });
  }

  private makeRequest(
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string> | undefined,
    onResponse: (status: number, body: string) => void,
    onError: (err: string) => void
  ): ReturnType<typeof httpRequest> {
    const isHttps = this.baseUrl.protocol === 'https:';
    const fn = isHttps ? httpsRequest : httpRequest;
    const opts: RequestOptions = {
      method,
      protocol: this.baseUrl.protocol,
      hostname: this.baseUrl.hostname,
      port: this.baseUrl.port || (isHttps ? 443 : 80),
      path,
      headers: headers ?? {},
      timeout: this.timeoutMs
    };

    const req = fn(opts, (resp) => {
      const chunks: Buffer[] = [];
      resp.on('data', (c: Buffer) => chunks.push(c));
      resp.on('end', () => {
        onResponse(resp.statusCode ?? 0, Buffer.concat(chunks).toString('utf-8'));
      });
      resp.on('error', (e) => onError(`response-error: ${e.message}`));
    });
    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
    req.on('error', (e) => onError(`request-error: ${e.message}`));
    return req;
  }
}

/**
 * For symmetry with the local Client API: a one-shot helper that emits a
 * single event without holding onto an HttpClient. Useful for one-off CLI
 * tools (`caia mentor record-correction "..."`).
 */
export async function httpEmitOnce<T extends EventType>(
  options: HttpClientOptions,
  type: T,
  payload: PayloadOf<T>,
  emitOpts: HttpEmitOptions = {}
): Promise<HttpEmitResult> {
  const c = new HttpClient(options);
  return c.emit(type, payload, emitOpts);
}

/**
 * Sanity-check at module load: every EventType has a Zod schema in
 * EVENT_SCHEMAS. Mirrors the local-Client behavior so the HTTP path can't
 * "succeed" emitting an unknown type.
 */
export function assertEverySchemaForHttp(): void {
  for (const t of EVENT_TYPES) {
    const schema = EVENT_SCHEMAS[t];
    if (!schema) {
      throw new Error(`assertEverySchemaForHttp: missing schema for ${t}`);
    }
    // describeSchema also exercises Zod's introspection — surfaces broken schemas.
    void describeSchema(schema);
  }
}
