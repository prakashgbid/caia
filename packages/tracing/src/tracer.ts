/**
 * Tracer + Span wrappers around `@opentelemetry/api`.
 *
 * This module is the original `index.ts` surface (createTracer, startSpan,
 * withSpan) extracted into its own file so the package can now also
 * export init/propagation/nats helpers from a single barrel.
 *
 * Behaviour preserved 1:1 with v0.2.0: the wrappers degrade gracefully
 * to no-op spans when no OTel SDK is installed (the api package
 * returns a NonRecordingSpan whose spanContext has all-zero ids), and
 * synthesise a random traceId/spanId in that case so callers can
 * still log a stable identifier.
 */

import {
  trace,
  SpanStatusCode,
  SpanKind,
  context as otelContext,
  type Span as OtelSpan,
  type Tracer as OtelTracer,
} from '@opentelemetry/api';

import type { Span, SpanContext, Tracer } from './types.js';

function wrapOtelSpan(otelSpan: OtelSpan, spanCtx: SpanContext): Span {
  return {
    context: spanCtx,
    setAttribute(key, value) {
      otelSpan.setAttribute(key, value);
    },
    addEvent(name, attrs) {
      otelSpan.addEvent(name, attrs);
    },
    setStatus(code, message) {
      if (message !== undefined) {
        otelSpan.setStatus({
          code: code === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
          message,
        });
      } else {
        otelSpan.setStatus({
          code: code === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        });
      }
    },
    end() {
      otelSpan.end();
    },
  };
}

function randomHex(bytes: number): string {
  return Array.from(
    { length: bytes },
    () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('');
}

export function buildSpanContext(
  otelSpan: OtelSpan,
  parent: SpanContext | undefined,
): SpanContext {
  const sc = otelSpan.spanContext();
  const traceId = sc.traceId.replace(/^0+$/, '') || parent?.traceId || randomHex(16);
  const spanId = sc.spanId.replace(/^0+$/, '') || randomHex(8);

  if (parent?.spanId !== undefined) {
    return { traceId, spanId, parentSpanId: parent.spanId };
  }
  return { traceId, spanId };
}

export function createTracer(name: string): Tracer {
  const otelTracer: OtelTracer = trace.getTracer(name);

  return {
    startSpan(spanName, options): Span {
      // If a parent SpanContext is supplied (typically rebuilt by
      // extractContext on the consumer side of a cross-process hop),
      // wrap it as a remote span and pass it via OtelContext so the
      // SDK records the child span's traceId == parent.traceId.
      // Without this, the SDK gives the child a fresh traceId,
      // breaking end-to-end propagation visibility in Tempo.
      let parentCtx = otelContext.active();
      if (options?.parent !== undefined) {
        const remote = trace.wrapSpanContext({
          traceId: options.parent.traceId,
          spanId: options.parent.spanId,
          traceFlags: 1, // SAMPLED — matches W3C traceparent flags=01
          isRemote: true,
        });
        parentCtx = trace.setSpan(otelContext.active(), remote);
      }
      const otelSpan = otelTracer.startSpan(
        spanName,
        { kind: SpanKind.INTERNAL },
        parentCtx,
      );
      const spanCtx = buildSpanContext(otelSpan, options?.parent);
      return wrapOtelSpan(otelSpan, spanCtx);
    },

    async withSpan<T>(
      spanName: string,
      fn: (span: Span) => T | Promise<T>,
      options?: { parent?: SpanContext },
    ): Promise<T> {
      const span = this.startSpan(spanName, options);
      try {
        const result = await fn(span);
        span.setStatus('ok');
        return result;
      } catch (err) {
        span.setStatus('error', err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        span.end();
      }
    },
  };
}

/** Internal helper used by other modules in this package. */
export { wrapOtelSpan };
