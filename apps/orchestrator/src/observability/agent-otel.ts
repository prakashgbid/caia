// apps/orchestrator/src/observability/agent-otel.ts
//
// OTel instrumentation for the agent layer.
//
// Wraps every agent runner (runPOAgent / runEAAgent / runBAAgent /
// runStoryValidatorAgent / runTestDesignAgent / runScaffolder /
// runDomainTriage / runDomainSpecialistMesh / runTaskScheduler) in
// a parent CLIENT span. Pipeline stages (pipeline.stage.advanced)
// emit their own per-stage spans that the agent spans nest inside.
//
// Together with PR obs-002's router span, this gives end-to-end
// trace-of-trace coverage:
//
//   pipeline-stage(po_decomposed)
//     └── agent(po-agent)
//           └── llm.route(po-decomposer-coverage-judge)
//                 └── gen_ai.system='claude-binary'
//                       └── (Claude binary spawn)
//
// Reference: caia-ai-tech-modernization-proposal-2026-04-30.md §6.7,
// §7 (the feedback-loop blueprint), §8 P0.5.

import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { Span, Tracer } from '@opentelemetry/api';

const TRACER_NAME = 'caia-orchestrator-agents';
const TRACER_VERSION = '0.1.0';

// --- Test seam ----------------------------------------------------
// Tests can inject a custom tracer (typically backed by an
// InMemorySpanExporter) to assert on emitted span shape.
let _tracerOverride: Tracer | null = null;
export function __setAgentTracer(tracer: Tracer | null): void {
  _tracerOverride = tracer;
}

export function getAgentTracer(): Tracer {
  return _tracerOverride ?? trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

// --- Attribute keys ------------------------------------------------
//
// The OTel GenAI semantic conventions (gen_ai.agent.*) cover the
// model-facing facets; we also emit CAIA-flavour `agent.*` and
// `pipeline.*` attributes that the dashboard + DSPy export read.
export const AGENT_ATTR = {
  NAME: 'agent.name',
  ROLE: 'agent.role',
  INPUT_SCHEMA: 'agent.input_schema',
  OUTPUT_SCHEMA: 'agent.output_schema',
  DURATION_MS: 'agent.duration_ms',
  JUDGE_SCORE: 'agent.judge_score',
  ATTEMPT: 'agent.attempt',
  OK: 'agent.ok',
  // Mirror gen_ai.agent.* so Langfuse's GenAI-aware dashboards
  // group agent spans correctly.
  GEN_AI_AGENT_NAME: 'gen_ai.agent.name',
  GEN_AI_AGENT_TYPE: 'gen_ai.agent.type',
} as const;

export const PIPELINE_ATTR = {
  STAGE: 'pipeline.stage',
  PROMPT_ID: 'pipeline.prompt_id',
  STORY_ID: 'pipeline.story_id',
  CORRELATION_ID: 'pipeline.correlation_id',
  PARENT_STAGE: 'pipeline.parent_stage',
} as const;

// --- Roles ---------------------------------------------------------
//
// Closed enumeration so dashboards / DSPy exports don't have to
// dedupe free-text role names.
export type AgentRole =
  | 'scaffolder'
  | 'po-decomposer'
  | 'ba-enricher'
  | 'ea-classifier'
  | 'ea-specialist'
  | 'domain-triage'
  | 'domain-specialist'
  | 'story-validator'
  | 'judge'
  | 'test-design'
  | 'task-scheduler'
  | 'bucket-placer'
  | 'release';

export interface WrapAgentOptions {
  /** Logical agent name (e.g. 'po-agent', 'story-validator-agent'). */
  name: string;
  /** Role for cross-agent grouping in the dashboard. */
  role: AgentRole;
  /** Optional: input zod schema name (e.g. 'POAgentInputV1'). */
  inputSchema?: string;
  /** Optional: output zod schema name. */
  outputSchema?: string;
  /** Optional: prompt ID this run is processing. */
  promptId?: string;
  /** Optional: story ID this run is processing. */
  storyId?: string;
  /** Optional: correlation ID for cross-event linking. */
  correlationId?: string;
  /** Optional: attempt number for retry-aware runners. */
  attempt?: number;
  /** Optional: extra resource attributes to stamp on the span. */
  extra?: Record<string, string | number | boolean>;
}

/**
 * Wrap an agent runner in an OTel CLIENT span.
 *
 * Usage:
 *
 *   export async function runPOAgent(input: POInput): Promise<POOutput> {
 *     return wrapAgent(
 *       { name: 'po-agent', role: 'po-decomposer',
 *         promptId: input.promptId },
 *       async (span) => {
 *         // ... existing body
 *         return result;
 *       },
 *     );
 *   }
 *
 * The span is automatically ended on completion (or thrown error).
 * On error, span.status is set to ERROR and the exception is
 * recorded as a span event.
 *
 * The wrapper sets `agent.duration_ms` on the span at end-time so
 * that downstream consumers (Langfuse, the trace export) don't
 * have to compute it from start/end timestamps.
 */
export async function wrapAgent<T>(
  opts: WrapAgentOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getAgentTracer();
  const startedAt = Date.now();
  const span = tracer.startSpan(`agent.${opts.name}`, {
    kind: SpanKind.CLIENT,
    attributes: filterAttrs({
      [AGENT_ATTR.NAME]: opts.name,
      [AGENT_ATTR.ROLE]: opts.role,
      [AGENT_ATTR.GEN_AI_AGENT_NAME]: opts.name,
      [AGENT_ATTR.GEN_AI_AGENT_TYPE]: opts.role,
      [AGENT_ATTR.INPUT_SCHEMA]: opts.inputSchema,
      [AGENT_ATTR.OUTPUT_SCHEMA]: opts.outputSchema,
      [AGENT_ATTR.ATTEMPT]: opts.attempt,
      [PIPELINE_ATTR.PROMPT_ID]: opts.promptId,
      [PIPELINE_ATTR.STORY_ID]: opts.storyId,
      [PIPELINE_ATTR.CORRELATION_ID]: opts.correlationId,
      ...(opts.extra ?? {}),
    }),
  });

  try {
    const result = await fn(span);
    span.setAttribute(AGENT_ATTR.DURATION_MS, Date.now() - startedAt);
    span.setAttribute(AGENT_ATTR.OK, true);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setAttribute(AGENT_ATTR.DURATION_MS, Date.now() - startedAt);
    span.setAttribute(AGENT_ATTR.OK, false);
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Stamp a judge score on the in-flight span. Used by validator /
 * judge sub-spans where the score is the central piece of evidence
 * the trace export needs.
 */
export function recordJudgeScore(span: Span, score: number): void {
  span.setAttribute(AGENT_ATTR.JUDGE_SCORE, score);
}

// --- Pipeline stage spans -----------------------------------------
//
// A pipeline-stage span wraps a `prompt_pipeline_stages` transition
// (the canonical event the orchestrator emits when a prompt advances).
// Agent spans nest inside the stage span if both are active.

export interface WrapPipelineStageOptions {
  stage: string;
  promptId?: string;
  storyId?: string;
  correlationId?: string;
  parentStage?: string;
  extra?: Record<string, string | number | boolean>;
}

export async function wrapPipelineStage<T>(
  opts: WrapPipelineStageOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getAgentTracer();
  const span = tracer.startSpan(`pipeline.${opts.stage}`, {
    kind: SpanKind.INTERNAL,
    attributes: filterAttrs({
      [PIPELINE_ATTR.STAGE]: opts.stage,
      [PIPELINE_ATTR.PROMPT_ID]: opts.promptId,
      [PIPELINE_ATTR.STORY_ID]: opts.storyId,
      [PIPELINE_ATTR.CORRELATION_ID]: opts.correlationId,
      [PIPELINE_ATTR.PARENT_STAGE]: opts.parentStage,
      ...(opts.extra ?? {}),
    }),
  });

  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    span.end();
  }
}

/** Drop undefined values; OTel rejects them. */
function filterAttrs(
  attrs: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
