import {
  trace,
  SpanStatusCode,
  SpanKind,
  type Span as OtelSpan,
  type Tracer as OtelTracer,
} from '@opentelemetry/api';

export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
}

export interface SpanAttributes {
  readonly [key: string]: string | number | boolean;
}

export interface Span {
  readonly context: SpanContext;
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attrs?: SpanAttributes): void;
  setStatus(code: 'ok' | 'error', message?: string): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, options?: { parent?: SpanContext }): Span;
  withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>, options?: { parent?: SpanContext }): Promise<T>;
}

function wrapOtelSpan(otelSpan: OtelSpan, spanCtx: SpanContext): Span {
  return {
    context: spanCtx,
    setAttribute(key, value) { otelSpan.setAttribute(key, value); },
    addEvent(name, attrs) { otelSpan.addEvent(name, attrs); },
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
    end() { otelSpan.end(); },
  };
}

function randomHex(bytes: number): string {
  return Array.from(
    { length: bytes },
    () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('');
}

function buildSpanContext(otelSpan: OtelSpan, parent: SpanContext | undefined): SpanContext {
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
      const otelSpan = otelTracer.startSpan(spanName, { kind: SpanKind.INTERNAL });
      const spanCtx = buildSpanContext(otelSpan, options?.parent);
      return wrapOtelSpan(otelSpan, spanCtx);
    },

    async withSpan<T>(spanName: string, fn: (span: Span) => T | Promise<T>, options?: { parent?: SpanContext }): Promise<T> {
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
