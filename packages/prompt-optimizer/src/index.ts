// @chiefaia/prompt-optimizer — public API.
//
// Composes the three stages from the design doc §5 into a single
// `optimize()` entry point used by the local-llm-router's claude-adapter,
// spawner, and MCP shim.
//
// Phase 5 of the Local-AI-First build chain.

import { emitOptimizerEvent, newOptimizerRunId } from './mentor-emit.js';
import { stage1Prepass } from './stage1.js';
import { stage2Summarize } from './stage2.js';
import {
  DEFAULT_SEGMENT_WEIGHTS,
  stage3Prune,
  type PromptSegment,
} from './stage3.js';
import {
  estimateTokens,
  type OptimizerInput,
  type OptimizerMetrics,
  type OptimizerResult,
  type StageMetrics,
} from './types.js';

export { stage1Prepass } from './stage1.js';
export { stage2Summarize } from './stage2.js';
export {
  DEFAULT_SEGMENT_WEIGHTS,
  pruneSegment,
  scoreHeuristic,
  stage3Prune,
  __resetRouter404Memo,
} from './stage3.js';
export type {
  OptimizerInput,
  OptimizerMetrics,
  OptimizerResult,
  ToolOutputBlob,
  OptimizerBudget,
  StageMetrics,
} from './types.js';
export { estimateTokens } from './types.js';
export type { PromptSegment, Stage3Options, Stage3Result } from './stage3.js';
export type { Stage1Options, Stage1Result } from './stage1.js';
export type { Stage2Options, Stage2BlobResult } from './stage2.js';

const DEFAULT_BUDGET = {
  stage2Ratio: 0.4,
  stage3Ratio: 0.5,
  skipStagesUnderTokens: 500,
  routerBaseUrl: 'http://127.0.0.1:7411',
  model: 'qwen2.5-coder:7b',
};

export async function optimize(input: OptimizerInput): Promise<OptimizerResult> {
  const startedAt = Date.now();
  const budget = { ...DEFAULT_BUDGET, ...(input.budget ?? {}) };
  const runId = newOptimizerRunId();

  // ─── Stage 1: prepass on every input blob ────────────────────────

  const stage1Start = Date.now();
  const stage1SystemPrompt = input.systemPrompt
    ? stage1Prepass(input.systemPrompt)
    : { text: '', protectedSpans: 0 };

  const stage1Blobs = (input.toolOutputs ?? []).map((blob) => ({
    original: blob,
    prepass: stage1Prepass(blob.content),
  }));

  const stage1ReasoningPrepass = (input.recentReasoning ?? []).map((r) =>
    stage1Prepass(r),
  );

  const protectedSpanCount =
    stage1SystemPrompt.protectedSpans +
    stage1Blobs.reduce((acc, b) => acc + b.prepass.protectedSpans, 0) +
    stage1ReasoningPrepass.reduce((acc, p) => acc + p.protectedSpans, 0);

  const stage1Out =
    [
      stage1SystemPrompt.text,
      ...stage1Blobs.map((b) => b.prepass.text),
      ...stage1ReasoningPrepass.map((p) => p.text),
      input.userQuestion,
    ]
      .filter(Boolean)
      .join('\n');

  const promptTokensRaw =
    estimateTokens(input.systemPrompt ?? '') +
    (input.toolOutputs ?? []).reduce((acc, b) => acc + estimateTokens(b.content), 0) +
    (input.recentReasoning ?? []).reduce((acc, r) => acc + estimateTokens(r), 0) +
    estimateTokens(input.userQuestion);

  const stage1Metrics: StageMetrics = {
    tokensIn: promptTokensRaw,
    tokensOut: estimateTokens(stage1Out),
    wallMs: Date.now() - stage1Start,
    ratio: 0,
    skipped: false,
  };
  stage1Metrics.ratio =
    stage1Metrics.tokensIn > 0 ? stage1Metrics.tokensOut / stage1Metrics.tokensIn : 1;

  emitOptimizerEvent('PromptOptimizerStage', {
    runId,
    stageNumber: 1,
    transform: 'stage1-prepass',
    tokensIn: stage1Metrics.tokensIn,
    tokensOut: stage1Metrics.tokensOut,
    durationMs: stage1Metrics.wallMs,
    noop: stage1Metrics.tokensIn === stage1Metrics.tokensOut,
  });

  // Cheap short-prompt bail-out: under the skip threshold, skip Stage 2/3.
  if (promptTokensRaw < budget.skipStagesUnderTokens) {
    // Emit explicit skip events so dashboards can distinguish "stage ran but
    // was a no-op" from "stage didn't run".
    emitOptimizerEvent('PromptOptimizerStage', {
      runId,
      stageNumber: 2,
      transform: 'stage2-summarize-skipped',
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
      noop: true,
    });
    emitOptimizerEvent('PromptOptimizerStage', {
      runId,
      stageNumber: 3,
      transform: 'stage3-prune-skipped',
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
      noop: true,
    });
    const totalWallMs = Date.now() - startedAt;
    return {
      optimizedPrompt: stage1Out,
      protectedSpanCount,
      metrics: {
        promptTokensRaw,
        stage1: stage1Metrics,
        stage2: {
          tokensIn: 0,
          tokensOut: 0,
          wallMs: 0,
          ratio: 1,
          skipped: true,
        },
        stage3: {
          tokensIn: 0,
          tokensOut: 0,
          wallMs: 0,
          ratio: 1,
          skipped: true,
        },
        totalWallMs,
      },
    };
  }

  // ─── Stage 2: per-blob summarize via router ──────────────────────

  const stage2Start = Date.now();
  const stage2 = await stage2Summarize(
    stage1Blobs.map((b) => ({
      id: b.original.id,
      content: b.prepass.text,
      source: b.original.source,
    })),
    {
      routerBaseUrl: budget.routerBaseUrl,
      model: budget.model,
      targetRatio: budget.stage2Ratio,
    },
  );

  const stage2BlobMap = new Map(stage2.blobs.map((b) => [b.id, b.content]));
  const stage2BlobsText = stage1Blobs.map((b) =>
    stage2BlobMap.get(b.original.id) ?? b.prepass.text,
  );

  const stage2TokensIn = stage1Blobs.reduce(
    (acc, b) => acc + estimateTokens(b.prepass.text),
    0,
  );
  const stage2TokensOut = stage2BlobsText.reduce((acc, t) => acc + estimateTokens(t), 0);
  const stage2Metrics: StageMetrics = {
    tokensIn: stage2TokensIn,
    tokensOut: stage2TokensOut,
    wallMs: Date.now() - stage2Start,
    ratio: stage2TokensIn > 0 ? stage2TokensOut / stage2TokensIn : 1,
    skipped: false,
    error: stage2.error,
  };

  emitOptimizerEvent('PromptOptimizerStage', {
    runId,
    stageNumber: 2,
    transform: 'stage2-summarize',
    tokensIn: stage2Metrics.tokensIn,
    tokensOut: stage2Metrics.tokensOut,
    durationMs: stage2Metrics.wallMs,
    noop: stage2Metrics.tokensIn === stage2Metrics.tokensOut,
  });

  // ─── Stage 3: question-aware prune over assembled prompt ─────────

  const segments: PromptSegment[] = [];
  if (stage1SystemPrompt.text) {
    segments.push({
      kind: 'system',
      text: stage1SystemPrompt.text,
      weight: DEFAULT_SEGMENT_WEIGHTS.system,
    });
  }
  // Most-recent tool outputs (last 3) get a lighter prune weight.
  const blobCount = stage2BlobsText.length;
  stage2BlobsText.forEach((text, i) => {
    const isRecent = i >= blobCount - 3;
    segments.push({
      kind: isRecent ? 'tool-output' : 'old-tool-output',
      text,
      weight: isRecent
        ? DEFAULT_SEGMENT_WEIGHTS['tool-output']
        : DEFAULT_SEGMENT_WEIGHTS['old-tool-output'],
    });
  });
  stage1ReasoningPrepass.forEach((p) => {
    segments.push({
      kind: 'recent-reasoning',
      text: p.text,
      weight: DEFAULT_SEGMENT_WEIGHTS['recent-reasoning'],
    });
  });
  segments.push({
    kind: 'user-question',
    text: input.userQuestion,
    weight: DEFAULT_SEGMENT_WEIGHTS['user-question'],
  });

  // optimize() already short-bailed above if the raw prompt was under
  // budget.skipStagesUnderTokens, so once we reach stage 3 we always run it
  // — let the per-segment weights decide what (if anything) to prune.
  const stage3 = await stage3Prune(segments, input.userQuestion, {
    targetRatio: budget.stage3Ratio,
    routerBaseUrl: budget.routerBaseUrl,
    model: budget.model,
    minTokensToPrune: 1,
  });

  const stage3Metrics: StageMetrics = {
    tokensIn: stage3.tokensIn,
    tokensOut: stage3.tokensOut,
    wallMs: stage3.wallMs,
    ratio: stage3.tokensIn > 0 ? stage3.tokensOut / stage3.tokensIn : 1,
    skipped: stage3.backend === 'skipped',
    error: stage3.error,
  };

  emitOptimizerEvent('PromptOptimizerStage', {
    runId,
    stageNumber: 3,
    transform:
      stage3.backend === 'skipped' ? 'stage3-prune-skipped' : 'stage3-prune',
    tokensIn: stage3Metrics.tokensIn,
    tokensOut: stage3Metrics.tokensOut,
    durationMs: stage3Metrics.wallMs,
    noop: stage3Metrics.tokensIn === stage3Metrics.tokensOut,
  });

  const metrics: OptimizerMetrics = {
    promptTokensRaw,
    stage1: stage1Metrics,
    stage2: stage2Metrics,
    stage3: stage3Metrics,
    totalWallMs: Date.now() - startedAt,
  };

  return {
    optimizedPrompt: stage3.text,
    metrics,
    protectedSpanCount,
  };
}
