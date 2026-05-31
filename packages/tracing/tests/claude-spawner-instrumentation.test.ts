/**
 * Tests for {@link withClaudeSpawnerSpan} — the wizard-side wrapper
 * around `@chiefaia/claude-spawner` calls.
 *
 * Tests stand up a real `BasicTracerProvider` with an in-memory
 * exporter so we can assert on the recorded span shape (name,
 * attributes, status, parent linkage). This is the same harness
 * used by `integration.test.ts` — proven to mirror what Tempo sees
 * over OTLP.
 *
 * We also install an `AsyncLocalStorageContextManager` so the OTel
 * context-propagation semantics inside `await otelContext.with(...)`
 * mirror what `initTracing()` would set up in production. Without
 * it the noop context manager treats `context.with` as a no-op and
 * nested spans don't see each other as parents.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { context as otelContext, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

import {
  withClaudeSpawnerSpan,
  withClaudeSpawnerChildSpan,
  DEFAULT_WIZARD_CLAUDE_SPAN_NAME,
} from '../src/claude-spawner-instrumentation.js';
import { createTracer } from '../src/tracer.js';
import { injectContext, extractContext } from '../src/propagation.js';
import type { TraceCarrier } from '../src/types.js';

const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider;
const ctxManager = new AsyncLocalStorageContextManager();

beforeAll(() => {
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  ctxManager.enable();
  otelContext.setGlobalContextManager(ctxManager);
});

afterEach(() => {
  exporter.reset();
});

afterAll(async () => {
  ctxManager.disable();
  await provider.shutdown();
});

describe('withClaudeSpawnerSpan — span creation', () => {
  it('emits a span with the default operation name', async () => {
    await withClaudeSpawnerSpan(
      { step: 'interview.answer', projectId: 'proj-1' },
      async () => 'ok',
    );
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const last = spans.at(-1)!;
    expect(last.name).toBe(DEFAULT_WIZARD_CLAUDE_SPAN_NAME);
  });

  it('honours operationName override', async () => {
    await withClaudeSpawnerSpan(
      { step: 'proposal.generate' },
      async () => 1,
      { operationName: 'claude.spawn.wizard.proposal.generate' },
    );
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.name).toBe('claude.spawn.wizard.proposal.generate');
  });
});

describe('withClaudeSpawnerSpan — attribute setting', () => {
  it('sets caia.wizard.step, project_id, tenant_id', async () => {
    await withClaudeSpawnerSpan(
      {
        step: 'interview.answer',
        projectId: 'proj-42',
        tenantId: 'tenant-99',
      },
      async () => undefined,
    );
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.attributes['caia.wizard.step']).toBe('interview.answer');
    expect(last.attributes['caia.wizard.project_id']).toBe('proj-42');
    expect(last.attributes['caia.wizard.tenant_id']).toBe('tenant-99');
  });

  it('sets caia.claude.prompt_template and caia.claude.model', async () => {
    await withClaudeSpawnerSpan(
      {
        step: 'proposal.generate',
        promptTemplate: 'proposal:exec-summary',
        model: 'claude-opus-4-6',
      },
      async () => undefined,
    );
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.attributes['caia.claude.prompt_template']).toBe('proposal:exec-summary');
    expect(last.attributes['caia.claude.model']).toBe('claude-opus-4-6');
  });

  it('passes through `extra` attributes verbatim', async () => {
    await withClaudeSpawnerSpan(
      {
        step: 'interview.answer',
        extra: {
          'caia.wizard.interview.source': 'live',
          'caia.wizard.turn_count': 5,
          'caia.wizard.exhausted': false,
        },
      },
      async () => undefined,
    );
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.attributes['caia.wizard.interview.source']).toBe('live');
    expect(last.attributes['caia.wizard.turn_count']).toBe(5);
    expect(last.attributes['caia.wizard.exhausted']).toBe(false);
  });

  it('sets caia.wizard.turn when provided', async () => {
    await withClaudeSpawnerSpan(
      { step: 'interview.answer', turn: 3 },
      async () => undefined,
    );
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.attributes['caia.wizard.turn']).toBe(3);
  });

  it('omits attributes when callers do not supply them', async () => {
    await withClaudeSpawnerSpan({ step: 'interview.answer' }, async () => undefined);
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.attributes['caia.wizard.project_id']).toBeUndefined();
    expect(last.attributes['caia.claude.model']).toBeUndefined();
    expect(last.attributes['caia.claude.prompt_template']).toBeUndefined();
  });
});

describe('withClaudeSpawnerSpan — success path (async resolve)', () => {
  it('returns the fn result and marks span ok', async () => {
    const result = await withClaudeSpawnerSpan(
      { step: 'interview.complete' },
      async () => ({ aggregateScore: 87 }),
    );
    expect(result).toEqual({ aggregateScore: 87 });
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.status.code).toBe(1 /* SpanStatusCode.OK */);
    expect(last.attributes['caia.claude.ok']).toBe(true);
  });

  it('records caia.claude.duration_ms on the span', async () => {
    await withClaudeSpawnerSpan({ step: 'interview.answer' }, async () => {
      await new Promise<void>((r) => setTimeout(r, 4));
    });
    const last = exporter.getFinishedSpans().at(-1)!;
    const dur = last.attributes['caia.claude.duration_ms'];
    expect(typeof dur).toBe('number');
    expect(dur as number).toBeGreaterThanOrEqual(0);
  });
});

describe('withClaudeSpawnerSpan — error capture (async reject)', () => {
  it('rethrows fn errors and marks span ERROR with the message', async () => {
    await expect(
      withClaudeSpawnerSpan({ step: 'interview.answer' }, async () => {
        throw new Error('claude went boom');
      }),
    ).rejects.toThrow('claude went boom');
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.status.code).toBe(2 /* SpanStatusCode.ERROR */);
    expect(last.status.message).toBe('claude went boom');
    expect(last.attributes['caia.claude.ok']).toBe(false);
  });

  it('records duration even on reject', async () => {
    await expect(
      withClaudeSpawnerSpan({ step: 'proposal.generate' }, async () => {
        await new Promise<void>((r) => setTimeout(r, 2));
        throw new Error('boom-with-delay');
      }),
    ).rejects.toThrow('boom-with-delay');
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(typeof last.attributes['caia.claude.duration_ms']).toBe('number');
  });

  it('ends the span on reject (no double-end leak)', async () => {
    const before = exporter.getFinishedSpans().length;
    await expect(
      withClaudeSpawnerSpan({ step: 'interview.answer' }, async () => {
        throw new Error('end-on-reject');
      }),
    ).rejects.toThrow('end-on-reject');
    const after = exporter.getFinishedSpans().length;
    expect(after).toBe(before + 1);
  });
});

describe('withClaudeSpawnerSpan — parent-child relationship', () => {
  it('inherits the traceId of an active route-level parent span', async () => {
    // Use the SDK tracer directly so the route span IS pushed into
    // OtelContext.active() via the SDK's `startActiveSpan` pattern.
    // (The manual `createTracer().withSpan` does not thread context
    // through OtelContext by design — preserved for backwards-compat
    // with the v0.2.0 surface; the wizard helper uses `context.with`
    // explicitly so its child spans inherit correctly.)
    const sdkTracer = trace.getTracer('@caia/wizard.route');
    await new Promise<void>((resolve, reject) => {
      sdkTracer.startActiveSpan('wizard.interview.answer', async (routeSpan) => {
        try {
          const routeTraceId = routeSpan.spanContext().traceId;
          await withClaudeSpawnerSpan(
            { step: 'interview.answer', projectId: 'p1' },
            async () => undefined,
          );
          const wizardSpan = exporter
            .getFinishedSpans()
            .find((s) => s.name === DEFAULT_WIZARD_CLAUDE_SPAN_NAME)!;
          expect(wizardSpan.spanContext().traceId).toBe(routeTraceId);
          routeSpan.end();
          resolve();
        } catch (err) {
          routeSpan.end();
          reject(err);
        }
      });
    });
  });

  it('uses an explicit parent context when provided (remote parent)', async () => {
    // Simulate a cross-process hop: caller hands us a parent SpanContext
    // it extracted from a `traceparent` header.
    const remoteTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const remoteSpanId = '00f067aa0ba902b7';
    await withClaudeSpawnerSpan(
      { step: 'architecture.run' },
      async () => undefined,
      { parent: { traceId: remoteTraceId, spanId: remoteSpanId } },
    );
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.spanContext().traceId).toBe(remoteTraceId);
  });
});

describe('withClaudeSpawnerSpan — W3C TraceContext propagation', () => {
  it('round-trips trace_id via injectContext + extractContext', async () => {
    const carrier: TraceCarrier = {};
    let originTraceId = '';
    await withClaudeSpawnerSpan(
      { step: 'interview.answer', projectId: 'p1' },
      async () => {
        // While the wizard span is active, inject the active context
        // into the carrier and parse it back — same path Tempo sees
        // on a cross-process hop.
        injectContext(carrier);
      },
    );
    const last = exporter.getFinishedSpans().at(-1)!;
    originTraceId = last.spanContext().traceId;
    const parent = extractContext(carrier);
    expect(parent).not.toBeNull();
    expect(parent!.traceId).toBe(originTraceId);
  });
});

describe('withClaudeSpawnerSpan — multi-step parent span', () => {
  it('nests multiple wizard claude calls under the same route span', async () => {
    const sdkTracer = trace.getTracer('@caia/wizard.route');
    await new Promise<void>((resolve, reject) => {
      sdkTracer.startActiveSpan('wizard.proposal.generate', async (routeSpan) => {
        try {
          const parentTraceId = routeSpan.spanContext().traceId;
          await withClaudeSpawnerSpan(
            { step: 'proposal.generate', promptTemplate: 'proposal:exec-summary' },
            async () => undefined,
          );
          await withClaudeSpawnerSpan(
            { step: 'proposal.generate', promptTemplate: 'proposal:full' },
            async () => undefined,
          );
          await withClaudeSpawnerSpan(
            { step: 'proposal.generate', promptTemplate: 'proposal:one-pager' },
            async () => undefined,
          );
          const wizardSpans = exporter
            .getFinishedSpans()
            .filter((s) => s.name === DEFAULT_WIZARD_CLAUDE_SPAN_NAME);
          expect(wizardSpans.length).toBe(3);
          for (const s of wizardSpans) {
            expect(s.spanContext().traceId).toBe(parentTraceId);
          }
          const templates = wizardSpans
            .map((s) => s.attributes['caia.claude.prompt_template'])
            .sort();
          expect(templates).toEqual([
            'proposal:exec-summary',
            'proposal:full',
            'proposal:one-pager',
          ]);
          routeSpan.end();
          resolve();
        } catch (err) {
          routeSpan.end();
          reject(err);
        }
      });
    });
  });
});

describe('withClaudeSpawnerChildSpan', () => {
  it('emits a span with the `.child` suffix by default', async () => {
    await withClaudeSpawnerChildSpan(
      { step: 'interview.answer' },
      async () => undefined,
    );
    const last = exporter.getFinishedSpans().at(-1)!;
    expect(last.name).toBe(`${DEFAULT_WIZARD_CLAUDE_SPAN_NAME}.child`);
  });
});

// Use a no-op reference so importing createTracer (kept for the future
// route-level integration tests we may add) isn't flagged by lint.
void createTracer;
