// Shared types for the three-stage optimizer pipeline.
//
// Phase 5 of the Local-AI-First build chain.

export interface ToolOutputBlob {
  id: string;
  content: string;
  // Optional source hint — used by Stage 1 to know whether to apply
  // file-fold heuristics ("file") vs JSON-normalize ("json") vs leave the
  // content alone ("opaque").
  source?: 'file' | 'json' | 'shell' | 'opaque' | undefined;
}

export interface OptimizerInput {
  systemPrompt?: string;
  toolOutputs?: ToolOutputBlob[];
  // Recent reasoning steps that should be preserved more aggressively than
  // older tool outputs. Stage 3 uses this segmentation for budget weighting.
  recentReasoning?: string[];
  userQuestion: string;
  budget?: OptimizerBudget;
}

export interface OptimizerBudget {
  // Target keep-ratio for Stage 2 (tool-output summarize). 0.4 = keep 40%.
  // Default 0.4.
  stage2Ratio?: number;
  // Target keep-ratio for Stage 3 (token-importance prune). 0.5 = keep 50%.
  // Default 0.5.
  stage3Ratio?: number;
  // If raw prompt token estimate is below this, skip Stage 2 and Stage 3
  // (compression is net loss). Default 500.
  skipStagesUnderTokens?: number;
  // Router endpoint for Stage 2. Default http://127.0.0.1:7411.
  routerBaseUrl?: string;
  // Model name for Stage 2 + Stage 3. Default qwen2.5-coder:7b.
  model?: string;
}

export interface StageMetrics {
  tokensIn: number;
  tokensOut: number;
  wallMs: number;
  ratio: number; // tokensOut / tokensIn
  skipped: boolean;
  error?: string | undefined;
}

export interface OptimizerMetrics {
  promptTokensRaw: number;
  stage1: StageMetrics;
  stage2: StageMetrics;
  stage3: StageMetrics;
  totalWallMs: number;
}

export interface OptimizerResult {
  optimizedPrompt: string;
  metrics: OptimizerMetrics;
  // Per-blob protected-span counts, useful for §8.2 "protected-span saves".
  protectedSpanCount: number;
}

// Rough token estimator used everywhere (the optimizer is itself running
// before a tokenizer is necessarily available, and we don't want to take a
// dependency on tiktoken/llama-tokenizer for what is essentially a budget
// hint). The formula is GPT-ish: ~4 chars per token. Verified within ±15%
// on the design doc's own text — good enough for ratio targets.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
