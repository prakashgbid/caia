/**
 * SDK bootstrap for @chiefaia/tracing.
 *
 * `initTracing(opts)` wires up the OTel NodeSDK with:
 *   - W3C TraceContext as the global propagator (see propagation.ts)
 *   - OTLP-HTTP exporter pointed at the in-cluster Tempo service
 *     (default: `http://tempo.chiefaia.svc.cluster.local:4318`)
 *   - Auto-instrumentations for: pg (Postgres), http (node:http +
 *     node:https), undici (the engine backing the global `fetch`)
 *     — IF the corresponding `@opentelemetry/instrumentation-*`
 *     packages are installed in the consumer app. These are listed
 *     as optional peerDependencies of @chiefaia/tracing: the upstream
 *     OTel auto-instrumentation version ranges drift independently
 *     of sdk-node, so we leave version selection to the consuming
 *     app. When a package is not installed, that specific
 *     instrumentation is silently skipped (the dynamic import is
 *     wrapped in `.catch(() => null)`).
 *
 * NATS is instrumented separately because there is no first-party
 * `@opentelemetry/instrumentation-nats` for the `nats@2` client we
 * use — see `./nats-instrumentation.ts` for the manual helper.
 *
 * `initTracing` is intentionally idempotent: callers in tests or
 * tools that re-import the entrypoint will not double-register.
 *
 * Hard constraints honoured here:
 *   - $0 new services: OTLP target is the in-cluster Tempo, no SaaS
 *   - Subscription-only: no API keys, no Anthropic SDK touched
 *   - Reuse-first: this extends @chiefaia/tracing rather than ship a
 *     parallel @chiefaia/otel
 */

import type { NodeSDK as NodeSDKType } from '@opentelemetry/sdk-node';

/** Options for {@link initTracing}. */
export interface InitTracingOptions {
  /** Logical service name. Required. Used as `service.name` in every span. */
  readonly serviceName: string;

  /**
   * OTLP-HTTP endpoint. Defaults to
   * `http://tempo.chiefaia.svc.cluster.local:4318` (Tempo's OTLP-HTTP
   * receiver inside the chiefaia K8s namespace). Override per
   * environment via `OTEL_EXPORTER_OTLP_ENDPOINT` or by passing this
   * field directly.
   */
  readonly otlpEndpoint?: string;

  /**
   * Service version. Defaults to `process.env.npm_package_version` if
   * available, otherwise `"0.0.0"`.
   */
  readonly serviceVersion?: string;

  /**
   * Deployment environment (`development`, `staging`, `production`,
   * `test`). Defaults to `process.env.NODE_ENV ?? "development"`.
   */
  readonly environment?: string;

  /**
   * Sampling ratio in [0, 1]. Defaults to 1.0 (sample everything) per
   * the V1 ratification — drop to 0.1 once trace volume warrants.
   */
  readonly samplingRatio?: number;

  /**
   * Extra resource attributes merged into every span (e.g.
   * `{ region: 'us-east-1' }`).
   */
  readonly resourceAttributes?: Readonly<Record<string, string>>;

  /**
   * Disable auto-instrumentations. Useful for the test suite where we
   * only want the manual span surface exercised. Defaults to false.
   */
  readonly disableAutoInstrumentations?: boolean;
}

/**
 * Singleton state. We hold a reference to the started NodeSDK so
 * `shutdownTracing()` can flush + close, and so a second
 * `initTracing()` call is a no-op.
 */
interface TracingState {
  sdk: NodeSDKType;
  serviceName: string;
}

let state: TracingState | null = null;

/** Default OTLP-HTTP endpoint when one is not supplied. */
export const DEFAULT_OTLP_ENDPOINT =
  'http://tempo.chiefaia.svc.cluster.local:4318';

/**
 * Initialise the OTel SDK.
 *
 * Safe to call multiple times: the second and subsequent calls are
 * no-ops and return the same logical state.
 *
 * @returns true on first call (SDK started), false on subsequent
 *          no-op calls.
 */
export async function initTracing(opts: InitTracingOptions): Promise<boolean> {
  if (state !== null) return false;

  // Dynamic imports keep the heavy SDK out of the import graph of
  // any consumer that only wants the lightweight span surface. This
  // is also what allows the manual tracer (`createTracer`) to work
  // in environments where the SDK is not installed at all.
  const [
    { NodeSDK },
    { OTLPTraceExporter },
    { resourceFromAttributes },
    semconv,
    sdkTraceBase,
    apiPkg,
    corePkg,
    pgPkg,
    httpPkg,
    undiciPkg,
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/semantic-conventions'),
    import('@opentelemetry/sdk-trace-base'),
    import('@opentelemetry/api'),
    import('@opentelemetry/core'),
    import('@opentelemetry/instrumentation-pg').catch(() => null),
    import('@opentelemetry/instrumentation-http').catch(() => null),
    import('@opentelemetry/instrumentation-undici').catch(() => null),
  ]);

  const endpoint =
    opts.otlpEndpoint ??
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
    DEFAULT_OTLP_ENDPOINT;

  const serviceVersion =
    opts.serviceVersion ?? process.env['npm_package_version'] ?? '0.0.0';

  const environment =
    opts.environment ?? process.env['NODE_ENV'] ?? 'development';

  const samplingRatio = opts.samplingRatio ?? 1.0;

  const baseAttrs: Record<string, string> = {
    [semconv.SEMRESATTRS_SERVICE_NAME]: opts.serviceName,
    [semconv.SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
    [semconv.SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
  };
  for (const [k, v] of Object.entries(opts.resourceAttributes ?? {})) {
    baseAttrs[k] = v;
  }

  const resource = resourceFromAttributes(baseAttrs);

  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
  });

  const sampler = new sdkTraceBase.ParentBasedSampler({
    root: new sdkTraceBase.TraceIdRatioBasedSampler(samplingRatio),
  });

  const instrumentations = opts.disableAutoInstrumentations
    ? []
    : [
        pgPkg ? new pgPkg.PgInstrumentation() : null,
        httpPkg ? new httpPkg.HttpInstrumentation() : null,
        undiciPkg ? new undiciPkg.UndiciInstrumentation() : null,
      ].filter((x): x is NonNullable<typeof x> => x !== null);

  // Set W3C TraceContext + Baggage propagators globally so headers
  // injected/extracted by ./propagation.ts agree with what
  // auto-instrumentations emit.
  apiPkg.propagation.setGlobalPropagator(
    new corePkg.CompositePropagator({
      propagators: [
        new corePkg.W3CTraceContextPropagator(),
        new corePkg.W3CBaggagePropagator(),
      ],
    }),
  );

  const sdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    sampler,
    instrumentations,
  });

  sdk.start();

  state = { sdk, serviceName: opts.serviceName };
  return true;
}

/**
 * Flush pending spans and shut down the SDK. Idempotent — safe to
 * call when no SDK was started.
 */
export async function shutdownTracing(): Promise<void> {
  if (state === null) return;
  const { sdk } = state;
  state = null;
  try {
    await sdk.shutdown();
  } catch {
    // SDK shutdown can throw if a span is in flight; swallowing is
    // intentional — shutdown is a best-effort flush, never a
    // correctness boundary.
  }
}

/** Returns true if {@link initTracing} has been called and not torn down. */
export function isTracingInitialised(): boolean {
  return state !== null;
}

/**
 * The current service name, or null if tracing has not been
 * initialised. Exposed mostly so test harnesses can assert.
 */
export function currentServiceName(): string | null {
  return state?.serviceName ?? null;
}

/**
 * TEST-ONLY: reset the singleton state without touching the SDK.
 * Used by the test suite to simulate fresh-process initialisation
 * across multiple test files. Never call from production code.
 *
 * @internal
 */
export function __resetTracingForTests(): void {
  state = null;
}
