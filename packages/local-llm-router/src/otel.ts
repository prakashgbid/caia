// packages/local-llm-router/src/otel.ts
//
// OTel instrumentation for the LLM router.
//
// Emits one span per route() call following the OpenTelemetry GenAI
// semantic conventions (`gen_ai.*`) plus a small set of CAIA-specific
// attributes (`caia.*`).
//
// The router is the single seam every Claude / Ollama call goes through,
// so a span here gives us full coverage of LLM traffic without having
// to instrument every call site individually.

import {
  trace,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

const TRACER_NAME = '@chiefaia/local-llm-router';
const TRACER_VERSION = '0.2.0';

// --- Test seam -------------------------------------------------------
// Tests can inject a custom tracer (typically backed by an
// InMemorySpanExporter) so we can assert on emitted span shape without
// running the full OTel SDK.
let _tracerOverride: Tracer | null = null;
export function __setTracer(tracer: Tracer | null): void {
  _tracerOverride = tracer;
}

export function getTracer(): Tracer {
  return _tracerOverride ?? trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

// --- Attribute keys (OTel GenAI semantic conventions) ----------------
// Reference: https://opentelemetry.io/docs/specs/semconv/gen-ai/
//
// We use the modern `gen_ai.usage.input_tokens` / `output_tokens` names
// AND emit the legacy `prompt_tokens` / `completion_tokens` aliases for
// downstream tooling that hasn't migrated yet (e.g. older Langfuse
// dashboards).
export const GEN_AI = {
  SYSTEM: 'gen_ai.system',
  PROVIDER_NAME: 'gen_ai.provider.name',
  OPERATION_NAME: 'gen_ai.operation.name',
  REQUEST_MODEL: 'gen_ai.request.model',
  REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  RESPONSE_MODEL: 'gen_ai.response.model',
  RESPONSE_ID: 'gen_ai.response.id',
  RESPONSE_FINISH_REASONS: 'gen_ai.response.finish_reasons',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  USAGE_PROMPT_TOKENS: 'gen_ai.usage.prompt_tokens',
  USAGE_COMPLETION_TOKENS: 'gen_ai.usage.completion_tokens',
  USAGE_TOTAL_TOKENS: 'gen_ai.usage.total_tokens',
} as const;

// --- CAIA-specific attribute keys ------------------------------------
export const CAIA_ATTR = {
  TASK_TYPE: 'caia.task_type',
  ROUTE_DECISION: 'caia.route_decision',
  CACHE_HIT: 'caia.cache_hit',
  FALLBACK_FROM: 'caia.fallback_from',
  FALLBACK_REASON: 'caia.fallback_reason',
  ROUTER_VERSION: 'caia.router_version',
} as const;

// `gen_ai.system` enumeration. Matches the no-API-key constraint in
// `feedback_no_api_key_billing.md` -- never "api-key", always one of:
//
// - "ollama"        -- local Ollama daemon
// - "claude-binary" -- `claude` CLI subscription path (Pro/Max OAuth)
// - "subscription"  -- alias for callers who treat all subscription
//                      paths uniformly
// - "cache"         -- served from the LLM cache without a model call
// - "stub"          -- test-only stub (in case a fake adapter is used)
export type GenAiSystem =
  | 'ollama'
  | 'claude-binary'
  | 'subscription'
  | 'cache'
  | 'stub';

export type RouteDecision = 'local' | 'claude' | 'cache_hit';

// --- Helper used by router.ts ----------------------------------------
export interface SpanContext {
  span: Span;
  /** End the span with the given response attrs and OK status. */
  recordSuccess(attrs: Record<string, string | number | boolean | undefined>): void;
  /** End the span with an error status. */
  recordError(err: unknown): void;
}

/**
 * Run `fn` inside a span and ensure the span is ended even on throw.
 * Returns `fn`'s result. Errors propagate.
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: (ctx: SpanContext) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(name, {
    kind: SpanKind.CLIENT,
    attributes: filterAttrs(attrs),
  });

  const ctx: SpanContext = {
    span,
    recordSuccess(extra) {
      span.setAttributes(filterAttrs(extra));
      span.setStatus({ code: SpanStatusCode.OK });
    },
    recordError(err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
    },
  };

  try {
    const result = await fn(ctx);
    return result;
  } catch (err) {
    ctx.recordError(err);
    throw err;
  } finally {
    span.end();
  }
}

/** Drop undefined values; OTel rejects them. */
function filterAttrs(
  attrs: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// --- Provider -> gen_ai.system mapping -------------------------------
export function genAiSystemFor(
  provider: 'local' | 'claude',
  model: string,
): GenAiSystem {
  if (provider === 'local') return 'ollama';
  if (provider === 'claude') {
    if (model.startsWith('claude-')) return 'claude-binary';
    return 'subscription';
  }
  return 'stub';
}

// --- SDK init (production) -------------------------------------------
//
// This is the only spot that imports the heavy @opentelemetry/sdk-node
// + exporter packages. Lazy-loaded so library imports don't pay the
// cost; tests never call this.

export interface InitOtelOptions {
  /** OTLP HTTP traces endpoint. */
  endpoint?: string;
  /** Service name in spans. Default: '@chiefaia/local-llm-router'. */
  serviceName?: string;
  /** Service version. Default: TRACER_VERSION. */
  serviceVersion?: string;
  /** Skip init entirely (no spans exported). */
  enabled?: boolean;
  /** Extra resource attributes -- env, host, deployment metadata. */
  resourceAttributes?: Record<string, string>;
  /** Authorization headers (e.g. Langfuse Basic auth). */
  headers?: Record<string, string>;
}

export interface OtelHandle {
  shutdown: () => Promise<void>;
}

/**
 * Initialize the OTel SDK and start exporting spans to the configured
 * OTLP endpoint. Returns a handle whose `shutdown()` flushes pending
 * spans before exit.
 *
 * Reads env (in priority order):
 *   - OTEL_SDK_DISABLED=true        -> no-op handle, no exports.
 *   - OTEL_EXPORTER_OTLP_ENDPOINT   -> traces endpoint.
 *   - OTEL_EXPORTER_OTLP_HEADERS    -> "Authorization=Basic ..." style.
 *
 * Default endpoint:
 *   http://localhost:3001/api/public/otel/v1/traces
 *   (the self-hosted Langfuse stack from PR obs-001).
 */
export async function initRouterOtel(
  opts: InitOtelOptions = {},
): Promise<OtelHandle> {
  const disabledViaEnv = process.env['OTEL_SDK_DISABLED'] === 'true';
  if (opts.enabled === false || disabledViaEnv) {
    return { shutdown: async () => {} };
  }

  const [{ NodeSDK }, { OTLPTraceExporter }, resources] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
  ]);

  const endpoint =
    opts.endpoint ??
    process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] ??
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
    'http://localhost:3001/api/public/otel/v1/traces';

  const headers =
    opts.headers ??
    parseEnvHeaders(process.env['OTEL_EXPORTER_OTLP_HEADERS']);

  const resourceAttrs: Record<string, string> = {
    'service.name': opts.serviceName ?? TRACER_NAME,
    'service.version': opts.serviceVersion ?? TRACER_VERSION,
    ...(opts.resourceAttributes ?? {}),
  };

  const sdk = new NodeSDK({
    resource: new resources.Resource(resourceAttrs),
    traceExporter: new OTLPTraceExporter({
      url: endpoint,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    }),
  });

  sdk.start();

  return {
    shutdown: async () => {
      try {
        await sdk.shutdown();
      } catch {
        // Shutdown is best-effort.
      }
    },
  };
}

/** Parse OTEL_EXPORTER_OTLP_HEADERS="key1=value1,key2=value2" -> object. */
function parseEnvHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}
