import { describe, it, expect } from 'vitest';
import { createTracer } from '../src/index.js';

describe('createTracer', () => {
  it('creates a span with traceId and spanId', () => {
    const tracer = createTracer('test');
    const span = tracer.startSpan('my-op');
    expect(span.context.traceId).toHaveLength(32);
    expect(span.context.spanId).toHaveLength(16);
    expect(span.context.parentSpanId).toBeUndefined();
  });

  it('child span inherits parent traceId', () => {
    const tracer = createTracer('test');
    const parent = tracer.startSpan('parent');
    const child = tracer.startSpan('child', { parent: parent.context });
    expect(child.context.traceId).toBe(parent.context.traceId);
    expect(child.context.parentSpanId).toBe(parent.context.spanId);
  });

  it('withSpan returns fn result', async () => {
    const tracer = createTracer('test');
    const result = await tracer.withSpan('op', async () => 42);
    expect(result).toBe(42);
  });

  it('withSpan rethrows errors', async () => {
    const tracer = createTracer('test');
    await expect(tracer.withSpan('op', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
