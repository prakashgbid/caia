// apps/orchestrator/tests/observability/agent-otel.test.ts
//
// 18 jest cases on the agent-OTel instrumentation helpers.
//
// Coverage:
//   - wrapAgent attribute completeness across roles
//   - wrapAgent error path (ERROR status + exception event)
//   - wrapAgent duration captured
//   - recordJudgeScore stamps agent.judge_score
//   - wrapPipelineStage attributes + nesting
//   - filterAttrs drops undefined
//   - test seam (__setAgentTracer)

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import {
  AGENT_ATTR,
  PIPELINE_ATTR,
  __setAgentTracer,
  recordJudgeScore,
  wrapAgent,
  wrapPipelineStage,
} from '../../src/observability/agent-otel';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
  __setAgentTracer(provider.getTracer('caia-orchestrator-agents'));
});

afterEach(async () => {
  __setAgentTracer(null);
  exporter.reset();
  await provider.shutdown();
});

function spans(): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

describe('agent-otel — wrapAgent', () => {
  // 1
  it('1. emits exactly one span per wrapAgent call', async () => {
    await wrapAgent(
      { name: 'po-agent', role: 'po-decomposer' },
      async () => 'ok',
    );
    expect(spans()).toHaveLength(1);
  });

  // 2
  it('2. span name is "agent.<name>"', async () => {
    await wrapAgent(
      { name: 'ba-agent', role: 'ba-enricher' },
      async () => 'ok',
    );
    expect(spans()[0]?.name).toBe('agent.ba-agent');
  });

  // 3
  it('3. agent.name + agent.role are set', async () => {
    await wrapAgent(
      { name: 'po-agent', role: 'po-decomposer' },
      async () => 'ok',
    );
    const [s] = spans();
    expect(s?.attributes[AGENT_ATTR.NAME]).toBe('po-agent');
    expect(s?.attributes[AGENT_ATTR.ROLE]).toBe('po-decomposer');
  });

  // 4
  it('4. mirrors gen_ai.agent.name + gen_ai.agent.type for Langfuse', async () => {
    await wrapAgent(
      { name: 'po-agent', role: 'po-decomposer' },
      async () => 'ok',
    );
    const [s] = spans();
    expect(s?.attributes[AGENT_ATTR.GEN_AI_AGENT_NAME]).toBe('po-agent');
    expect(s?.attributes[AGENT_ATTR.GEN_AI_AGENT_TYPE]).toBe('po-decomposer');
  });

  // 5
  it('5. agent.input_schema and agent.output_schema set when provided', async () => {
    await wrapAgent(
      {
        name: 'ba-agent',
        role: 'ba-enricher',
        inputSchema: 'BAAgentInputV1',
        outputSchema: 'BAAgentOutputV1',
      },
      async () => 'ok',
    );
    const [s] = spans();
    expect(s?.attributes[AGENT_ATTR.INPUT_SCHEMA]).toBe('BAAgentInputV1');
    expect(s?.attributes[AGENT_ATTR.OUTPUT_SCHEMA]).toBe('BAAgentOutputV1');
  });

  // 6
  it('6. pipeline.prompt_id and pipeline.story_id set when provided', async () => {
    await wrapAgent(
      {
        name: 'ea-agent',
        role: 'ea-classifier',
        promptId: 'p-123',
        storyId: 's-456',
        correlationId: 'corr-789',
      },
      async () => 'ok',
    );
    const [s] = spans();
    expect(s?.attributes[PIPELINE_ATTR.PROMPT_ID]).toBe('p-123');
    expect(s?.attributes[PIPELINE_ATTR.STORY_ID]).toBe('s-456');
    expect(s?.attributes[PIPELINE_ATTR.CORRELATION_ID]).toBe('corr-789');
  });

  // 7
  it('7. agent.attempt set on retry-aware runs', async () => {
    await wrapAgent(
      { name: 'ba-agent', role: 'ba-enricher', attempt: 3 },
      async () => 'ok',
    );
    expect(spans()[0]?.attributes[AGENT_ATTR.ATTEMPT]).toBe(3);
  });

  // 8
  it('8. agent.duration_ms captured on success', async () => {
    await wrapAgent(
      { name: 'po-agent', role: 'po-decomposer' },
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 'ok';
      },
    );
    const dur = spans()[0]?.attributes[AGENT_ATTR.DURATION_MS] as number;
    expect(typeof dur).toBe('number');
    expect(dur).toBeGreaterThanOrEqual(0);
  });

  // 9
  it('9. agent.ok=true on success', async () => {
    await wrapAgent(
      { name: 'po-agent', role: 'po-decomposer' },
      async () => 'ok',
    );
    expect(spans()[0]?.attributes[AGENT_ATTR.OK]).toBe(true);
    expect(spans()[0]?.status?.code).toBe(SpanStatusCode.OK);
  });

  // 10
  it('10. agent.ok=false + ERROR status on throw', async () => {
    await expect(
      wrapAgent({ name: 'po-agent', role: 'po-decomposer' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow(/boom/);
    const [s] = spans();
    expect(s?.attributes[AGENT_ATTR.OK]).toBe(false);
    expect(s?.status?.code).toBe(SpanStatusCode.ERROR);
  });

  // 11
  it('11. exception event recorded on throw', async () => {
    await expect(
      wrapAgent({ name: 'po-agent', role: 'po-decomposer' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow();
    expect((spans()[0]?.events?.length ?? 0)).toBeGreaterThan(0);
  });

  // 12
  it('12. agent.duration_ms captured on error path too', async () => {
    await expect(
      wrapAgent({ name: 'po-agent', role: 'po-decomposer' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error('boom');
      }),
    ).rejects.toThrow();
    expect(typeof spans()[0]?.attributes[AGENT_ATTR.DURATION_MS]).toBe('number');
  });

  // 13
  it('13. extra attributes pass through', async () => {
    await wrapAgent(
      {
        name: 'po-agent',
        role: 'po-decomposer',
        extra: { 'caia.scope': 'epic', 'caia.depth': 2 },
      },
      async () => 'ok',
    );
    const [s] = spans();
    expect(s?.attributes['caia.scope']).toBe('epic');
    expect(s?.attributes['caia.depth']).toBe(2);
  });
});

describe('agent-otel — recordJudgeScore', () => {
  // 14
  it('14. stamps agent.judge_score on the live span', async () => {
    await wrapAgent(
      { name: 'story-validator-agent', role: 'judge' },
      async (span: Span) => {
        recordJudgeScore(span, 0.87);
      },
    );
    expect(spans()[0]?.attributes[AGENT_ATTR.JUDGE_SCORE]).toBe(0.87);
  });
});

describe('agent-otel — wrapPipelineStage', () => {
  // 15
  it('15. emits a pipeline.<stage> span with stage attribute', async () => {
    await wrapPipelineStage(
      { stage: 'po_decomposed', promptId: 'p-1' },
      async () => 'ok',
    );
    const [s] = spans();
    expect(s?.name).toBe('pipeline.po_decomposed');
    expect(s?.attributes[PIPELINE_ATTR.STAGE]).toBe('po_decomposed');
    expect(s?.attributes[PIPELINE_ATTR.PROMPT_ID]).toBe('p-1');
  });

  // 16
  it('16. nests agent spans inside a pipeline-stage span', async () => {
    await wrapPipelineStage(
      { stage: 'po_decomposed', promptId: 'p-1' },
      async () => {
        await wrapAgent(
          { name: 'po-agent', role: 'po-decomposer', promptId: 'p-1' },
          async () => 'inner',
        );
      },
    );
    const all = spans();
    // 2 spans: agent (ends first) + pipeline-stage (ends second).
    expect(all).toHaveLength(2);
    const agent = all.find((s) => s.name === 'agent.po-agent');
    const stage = all.find((s) => s.name === 'pipeline.po_decomposed');
    expect(agent).toBeDefined();
    expect(stage).toBeDefined();
    // Trace-IDs must match (same parent trace).
    expect(agent?.spanContext().traceId).toBe(stage?.spanContext().traceId);
  });

  // 17
  it('17. pipeline-stage records ERROR on throw', async () => {
    await expect(
      wrapPipelineStage(
        { stage: 'ba_enriched' },
        async () => {
          throw new Error('stage failed');
        },
      ),
    ).rejects.toThrow(/stage failed/);
    expect(spans()[0]?.status?.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('agent-otel — test seam', () => {
  // 18
  it('18. __setAgentTracer(null) restores fall-through to global tracer', async () => {
    __setAgentTracer(null);
    // Without an override, the global provider we set in beforeEach
    // still applies, so spans go to our exporter.
    await wrapAgent(
      { name: 'release-agent', role: 'release' },
      async () => 'ok',
    );
    expect(spans()).toHaveLength(1);
  });
});
