/**
 * W3C TraceContext propagation helpers.
 *
 * These let CAIA code stuff a trace into a NATS message header, an
 * outbound HTTP request, an event envelope, or any other carrier
 * shape that maps cleanly to `Record<string, string>`. The carrier
 * is then carried across the process boundary; the receiver calls
 * `extractContext` to rebuild a SpanContext that can be passed as
 * the `parent` option to `tracer.startSpan` / `tracer.withSpan`.
 *
 * The wire format is the W3C TraceContext recommendation
 * (https://www.w3.org/TR/trace-context/) — i.e. the `traceparent` and
 * optional `tracestate` HTTP headers. The OTel propagator generates
 * and parses both verbatim, so spans propagated through these helpers
 * are also visible to any non-CAIA service speaking the standard.
 *
 * The implementation is intentionally synchronous and dependency-free
 * at the import level — it relies only on the always-present
 * `@opentelemetry/api`, never on the SDK. That keeps tests and
 * lightweight tools that never call `initTracing()` working.
 */

import {
  propagation,
  trace,
  context as otelContext,
  type Context as OtelContext,
} from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';

import type { SpanContext, TraceCarrier } from './types.js';

/**
 * Install the W3C TraceContext + Baggage propagators eagerly at
 * module-load time. This makes injectContext / extractContext work
 * for callers that never call `initTracing()` (most unit tests, and
 * any lightweight tool that just wants propagation glue without the
 * full SDK). When `initTracing()` IS called it overwrites this with
 * the same propagators — net no-op.
 *
 * Idempotent because @opentelemetry/api's globalPropagator setter
 * just stores the most recent value.
 */
propagation.setGlobalPropagator(
  new CompositePropagator({
    propagators: [
      new W3CTraceContextPropagator(),
      new W3CBaggagePropagator(),
    ],
  }),
);

/**
 * Inject the *currently active* OTel context (or the supplied
 * `spanCtx`) into a carrier. Mutates and returns the carrier so
 * callers can use it inline:
 *
 *   await nats.publish(subject, payload, { headers: injectContext({}) });
 *
 * If neither an active context nor a `spanCtx` is available, the
 * carrier is returned unchanged.
 */
export function injectContext(
  carrier: TraceCarrier = {},
  spanCtx?: SpanContext,
): TraceCarrier {
  const ctx = spanCtxToOtelContext(spanCtx);
  propagation.inject(ctx, carrier, {
    set(c, k, v) {
      // OTel passes string values for traceparent/tracestate.
      (c as TraceCarrier)[k] = String(v);
    },
  });
  return carrier;
}

/**
 * Extract a SpanContext from a carrier. Returns null when the
 * carrier has no parseable `traceparent` header.
 */
export function extractContext(carrier: TraceCarrier): SpanContext | null {
  if (!carrier.traceparent) return null;
  const ctx = propagation.extract(otelContext.active(), carrier, {
    get(c, k) {
      return (c as TraceCarrier)[k];
    },
    keys(c) {
      return Object.keys(c as TraceCarrier);
    },
  });
  const span = trace.getSpan(ctx);
  if (!span) return null;
  const sc = span.spanContext();
  // The W3C propagator gives us a 16-byte hex traceId and 8-byte
  // hex spanId. We surface them as-is so they round-trip cleanly
  // with the Tracer surface in tracer.ts.
  return {
    traceId: sc.traceId,
    spanId: sc.spanId,
  };
}

/**
 * Convenience for callers that have a SpanContext from the tracer
 * surface but want a child OtelContext to inject from. Returns
 * `context.active()` when `spanCtx` is omitted so the *currently
 * running* span (set by `withSpan` via the SDK's context manager) is
 * used.
 *
 * Exposed for advanced use; most callers want `injectContext` or
 * `extractContext` directly.
 */
export function spanCtxToOtelContext(spanCtx?: SpanContext): OtelContext {
  if (!spanCtx) return otelContext.active();
  const synthetic = trace.wrapSpanContext({
    traceId: spanCtx.traceId,
    spanId: spanCtx.spanId,
    traceFlags: 1, // SAMPLED
    isRemote: true,
  });
  return trace.setSpan(otelContext.active(), synthetic);
}

/**
 * Parse a `traceparent` header string into its 4 components. Useful
 * for tests and for logging. Returns null on malformed input.
 *
 * Format: `version-traceId-spanId-traceFlags`
 *         `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
 */
export function parseTraceparent(
  traceparent: string,
): { version: string; traceId: string; spanId: string; flags: string } | null {
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(
    traceparent,
  );
  if (!m) return null;
  return {
    version: m[1]!,
    traceId: m[2]!,
    spanId: m[3]!,
    flags: m[4]!,
  };
}
