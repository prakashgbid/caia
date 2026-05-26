/**
 * Shared types for @chiefaia/tracing.
 *
 * Kept in a dedicated module so they can be imported by tracer.ts,
 * propagation.ts, init.ts, and nats-instrumentation.ts without
 * creating an import cycle through index.ts.
 */

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
  withSpan<T>(
    name: string,
    fn: (span: Span) => T | Promise<T>,
    options?: { parent?: SpanContext },
  ): Promise<T>;
}

/**
 * W3C TraceContext carrier. The two header names are the canonical
 * names emitted/consumed by the W3C propagator: `traceparent` is
 * mandatory; `tracestate` is optional and carries vendor-specific
 * extensions.
 */
export interface TraceCarrier {
  traceparent?: string;
  tracestate?: string;
  [k: string]: string | undefined;
}
