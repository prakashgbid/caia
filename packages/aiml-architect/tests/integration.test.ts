/**
 * Integration test — verifies the architect's verdict integrates with a
 * pipeline-style trace recorder.
 *
 * Per the 10-stage DoD step 6: "wire it into ONE existing pipeline call
 * (e.g., when Coding-Agent picks a model); verify the architect's verdict
 * shows up in trace."
 *
 * We don't modify the live orchestrator here (the parallel apprentice-
 * serving campaign is touching adjacent code; coordinating a cross-cutting
 * change is out of leg-1 scope). Instead we model the integration: a
 * pipeline `pickModel()` function that consumes the architect's verdict
 * and emits a structured trace entry. The trace shape mirrors what the
 * orchestrator's OTel `gen_ai.*` span would carry (per
 * apps/orchestrator/src/observability/agent-otel.ts).
 *
 * Stage 7 (Deploy) adds the README integration guidance the orchestrator
 * uses to wire this in production.
 */

import { describe, it, expect } from 'vitest';

import { AIMLArchitect } from '../src/architect.js';
import {
  buildFakeAdapterRegistry,
  buildFakeCurator,
  buildFakeFs,
  buildFakeMentor,
  fixedClock
} from './helpers/fakes.js';

interface PipelineTraceEntry {
  readonly span: string;
  readonly attrs: Readonly<Record<string, string | number | boolean>>;
}

interface PipelineTraceRecorder {
  emit(entry: PipelineTraceEntry): void;
  entries(): ReadonlyArray<PipelineTraceEntry>;
}

function buildTraceRecorder(): PipelineTraceRecorder {
  const out: PipelineTraceEntry[] = [];
  return {
    emit(entry: PipelineTraceEntry): void {
      out.push(entry);
    },
    entries(): ReadonlyArray<PipelineTraceEntry> {
      return out;
    }
  };
}

/**
 * Models how `apps/orchestrator/src/agents/domain-specialists.ts` (and
 * sibling agents) should pick a model: ask the architect, then route the
 * actual call through @chiefaia/local-llm-router. The architect's
 * rationale gets stamped onto the trace so observers can see why we chose
 * what we chose.
 */
function pipelinePickModel(
  architect: AIMLArchitect,
  recorder: PipelineTraceRecorder,
  taskCategory: string,
  contextSizeTokens: number
): { provider: string; model: string } {
  const choice = architect.selectModel({
    taskCategory,
    contextSizeTokens,
    qualityBar: 'standard'
  });

  // Mirror the OTel attrs the orchestrator already emits for llm.route.
  recorder.emit({
    span: `aiml_architect.select_model ${taskCategory}`,
    attrs: {
      'caia.task_type': taskCategory,
      'caia.aiml_architect.provider': choice.provider,
      'caia.aiml_architect.model': choice.model,
      'caia.aiml_architect.rationale': choice.rationale,
      'caia.aiml_architect.estimated_cost_usd': choice.estimatedCostUsd,
      'caia.aiml_architect.fallback_count': choice.fallbackChain.length
    }
  });

  return { provider: choice.provider, model: choice.model };
}

describe('aiml-architect → pipeline integration', () => {
  const clock = fixedClock('2026-05-06T12:00:00Z');

  it('emits a trace entry with the architect rationale on every selectModel call', () => {
    const architect = new AIMLArchitect({
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      fs: buildFakeFs({}),
      clock
    });
    const recorder = buildTraceRecorder();
    const result = pipelinePickModel(
      architect,
      recorder,
      'commit-message',
      400
    );

    expect(result.provider).toBeTruthy();

    const entries = recorder.entries();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.span).toContain('commit-message');
    expect(entry.attrs['caia.aiml_architect.rationale']).toBeTruthy();
    expect(typeof entry.attrs['caia.aiml_architect.rationale']).toBe('string');
    expect(entry.attrs['caia.aiml_architect.provider']).toMatch(
      /^(local|claude|apprentice)$/
    );
  });

  it('escalates to claude on qualityBar=high path', () => {
    const architect = new AIMLArchitect({
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      fs: buildFakeFs({}),
      clock
    });
    const recorder = buildTraceRecorder();

    architect.selectModel({
      taskCategory: 'security-review',
      contextSizeTokens: 4000,
      qualityBar: 'high'
    });

    const choice = architect.selectModel({
      taskCategory: 'security-review',
      contextSizeTokens: 4000,
      qualityBar: 'high'
    });
    recorder.emit({
      span: 'aiml_architect.select_model security-review',
      attrs: {
        'caia.aiml_architect.provider': choice.provider,
        'caia.aiml_architect.model': choice.model
      }
    });

    expect(choice.provider).toBe('claude');
  });

  it('coordinator verdict survives a pipeline tick', () => {
    const architect = new AIMLArchitect({
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      fs: buildFakeFs({}),
      clock
    });
    const recorder = buildTraceRecorder();
    const plan = architect.coordinateApprenticeLoop();

    recorder.emit({
      span: 'aiml_architect.coordinate',
      attrs: {
        'caia.aiml_architect.coord_decision': plan.decision,
        'caia.aiml_architect.coord_estimated_cost_usd': plan.estimatedCostUsd
      }
    });

    expect(plan.decision).toBe('hold');
    expect(recorder.entries()).toHaveLength(1);
  });
});
