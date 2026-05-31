/**
 * @chiefaia/tracing — OpenTelemetry tracing for the CAIA spine.
 *
 * Surface (v0.3.1):
 *
 *   - createTracer / startSpan / withSpan   — the v0.2.0 manual tracer (unchanged)
 *   - initTracing / shutdownTracing         — NodeSDK bootstrap + OTLP wiring
 *   - injectContext / extractContext        — W3C TraceContext propagation
 *   - withNatsPublishSpan / withNatsConsumeSpan — manual NATS instrumentation
 *   - withClaudeSpawnerSpan / withClaudeSpawnerChildSpan — wizard-side
 *     wrapper around `@chiefaia/claude-spawner` calls (Phase B B3)
 *
 * Reuse-first: this package is the canonical OTel surface for CAIA.
 * Do not ship a parallel `@chiefaia/otel`. See PLAN.md in the
 * feature/otel-tracing-tempo-2026-05-25 PR for the reuse decision.
 */

export type {
  Span,
  SpanAttributes,
  SpanContext,
  TraceCarrier,
  Tracer,
} from './types.js';

export { createTracer } from './tracer.js';

export {
  initTracing,
  shutdownTracing,
  isTracingInitialised,
  currentServiceName,
  DEFAULT_OTLP_ENDPOINT,
  type InitTracingOptions,
} from './init.js';

export {
  injectContext,
  extractContext,
  parseTraceparent,
  spanCtxToOtelContext,
} from './propagation.js';

export {
  withNatsPublishSpan,
  withNatsConsumeSpan,
  type NatsPublishSpanOpts,
  type NatsConsumeSpanOpts,
} from './nats-instrumentation.js';

export {
  withClaudeSpawnerSpan,
  withClaudeSpawnerChildSpan,
  WIZARD_CLAUDE_TRACER_NAME,
  DEFAULT_WIZARD_CLAUDE_SPAN_NAME,
  type WizardClaudeSpanAttributes,
  type WithClaudeSpawnerSpanOptions,
} from './claude-spawner-instrumentation.js';
