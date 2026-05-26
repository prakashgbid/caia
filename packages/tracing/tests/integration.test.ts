/**
 * Integration: span the manual tracer with a real InMemorySpanExporter
 * wired in via a NodeTracerProvider. This proves the v0.3.0 surface
 * still emits spans the OTel SDK can collect and ship — i.e. the
 * shape Tempo would receive over OTLP.
 *
 * We use InMemorySpanExporter rather than spinning up a real Tempo
 * because (a) Tempo runs in K3s, not in CI, and (b) the OTLP-HTTP
 * exporter wire format is exercised by the OTel library's own
 * upstream suite — what we need to verify here is *our* glue: that
 * createTracer + withSpan + injectContext produce a SpanData object
 * with the expected name, attributes, and parent linkage.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';

import { createTracer } from '../src/tracer.js';
import { injectContext, extractContext } from '../src/propagation.js';
import type { TraceCarrier } from '../src/types.js';

const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider;

beforeAll(() => {
  // sdk-trace-base 2.x removed `addSpanProcessor` from BasicTracerProvider —
  // span processors are passed via the constructor instead.
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
});

describe('SDK integration', () => {
  it('createTracer emits a span captured by the in-memory exporter', async () => {
    exporter.reset();
    const tracer = createTracer('integration-test');
    await tracer.withSpan('integration.op', async (span) => {
      span.setAttribute('caia.test', 'yes');
    });
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const last = spans[spans.length - 1]!;
    expect(last.name).toBe('integration.op');
    expect(last.attributes['caia.test']).toBe('yes');
  });

  it('records OK status on success', async () => {
    exporter.reset();
    const tracer = createTracer('integration-test');
    await tracer.withSpan('ok.op', async () => 1);
    const last = exporter.getFinishedSpans().slice(-1)[0]!;
    expect(last.status.code).toBe(1 /* SpanStatusCode.OK */);
  });

  it('records ERROR status + message when fn throws', async () => {
    exporter.reset();
    const tracer = createTracer('integration-test');
    await expect(
      tracer.withSpan('err.op', async () => {
        throw new Error('integration boom');
      }),
    ).rejects.toThrow('integration boom');
    const last = exporter.getFinishedSpans().slice(-1)[0]!;
    expect(last.status.code).toBe(2 /* SpanStatusCode.ERROR */);
    expect(last.status.message).toBe('integration boom');
  });

  it('propagation round-trip preserves the traceId across processes', async () => {
    exporter.reset();
    const tracer = createTracer('integration-test');

    // Producer side: emit a span and inject its context.
    const carrier: TraceCarrier = {};
    let producerTraceId = '';
    await tracer.withSpan('producer.publish', async (span) => {
      producerTraceId = span.context.traceId;
      injectContext(carrier, span.context);
    });

    // Consumer side: rebuild the parent and start a child span.
    const parent = extractContext(carrier);
    expect(parent).not.toBeNull();
    expect(parent!.traceId).toBe(producerTraceId);

    await tracer.withSpan(
      'consumer.handle',
      async (span) => {
        expect(span.context.traceId).toBe(producerTraceId);
      },
      { parent: parent! },
    );
  });
});
