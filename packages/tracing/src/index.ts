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

function randomHex(bytes: number): string {
  return Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}

export function createTracer(name: string): Tracer {
  return {
    startSpan(spanName, options) {
      const context: SpanContext = {
        traceId: options?.parent?.traceId ?? randomHex(16),
        spanId: randomHex(8),
        parentSpanId: options?.parent?.spanId,
      };
      return {
        context,
        setAttribute() {},
        addEvent() {},
        setStatus() {},
        end() {},
      };
    },

    async withSpan(spanName, fn, options) {
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
