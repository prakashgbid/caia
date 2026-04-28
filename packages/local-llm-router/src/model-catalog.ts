// Model catalog for @chiefaia/local-llm-router (LAI-001)
//
// A typed registry of every local Ollama model the router knows about, with
// the metadata needed to pick the right one for a given task: parameter
// count, runtime RAM at Q4_K_M, on-disk size, role, and whether the chat or
// generate endpoint is preferred.
//
// This module is purely informational — it does NOT change routing decisions.
// LAI-005 (routing-rule enrichment) will use this catalog to add new task
// types backed by 14B-class models.

export type ModelRole =
  /** Strong general-purpose chat / instruction following */
  | 'generalist'
  /** Specialized for code generation / completion */
  | 'coder'
  /** Optimized for math / STEM / reasoning chains */
  | 'reasoning'
  /** Long-context (>=64k tokens) */
  | 'long-context'
  /** Generates text embeddings, not text completions */
  | 'embeddings';

export type EndpointKind =
  /** /api/generate — flat text completion */
  | 'generate'
  /** /api/chat — message-based, supports `think:false` for Qwen3 */
  | 'chat'
  /** /api/embeddings */
  | 'embeddings';

export interface LocalModel {
  /** Ollama tag, e.g. "qwen3:14b" */
  tag: string;
  /** Approximate parameter count (e.g. "14B", "137M") */
  params: string;
  /**
   * Approximate runtime RAM at Q4_K_M, in GB. Used to budget concurrent loads
   * on a 16GB M1 Pro (usable model RAM ≈ 10–12 GB after OS overhead).
   */
  runtimeRamGB: number;
  /** Approximate on-disk size in GB (Q4_K_M unless noted) */
  diskSizeGB: number;
  /** What this model is good at */
  role: ModelRole;
  /** Which Ollama endpoint to use for best results */
  endpoint: EndpointKind;
  /**
   * For Qwen3 family: whether the model emits "thinking" tokens by default.
   * When true, callers should use the chat endpoint with `think:false`
   * (or include `/no_think` in the prompt) to suppress the chain of thought
   * and reduce wall-clock latency.
   */
  emitsThinkingByDefault?: boolean;
  /** One-line summary of why we keep this model in the catalog */
  notes: string;
}

/**
 * Models known to the router. Order is loosely "smallest to largest within role".
 *
 * To add a model: pull it (`ollama pull <tag>`), verify it loads with a
 * smoke prompt, measure runtime RAM via `ollama ps`, then add an entry here.
 */
export const MODEL_CATALOG: readonly LocalModel[] = [
  // ─── coders ───────────────────────────────────────────────────────────────
  {
    tag: 'qwen2.5-coder:7b',
    params: '7B',
    runtimeRamGB: 4.5,
    diskSizeGB: 4.7,
    role: 'coder',
    endpoint: 'generate',
    notes:
      'Default low-latency coder. Strong on HumanEval (88%); used as the ' +
      'fast path for classification, dedup, and small enrichment tasks.',
  },
  {
    tag: 'qwen2.5-coder:14b',
    params: '14B',
    runtimeRamGB: 8.5,
    diskSizeGB: 9.0,
    role: 'coder',
    endpoint: 'generate',
    notes:
      'Bigger coder. Marginal gain on HumanEval over the 7B variant; reach ' +
      'for it on multi-file edits or longer code reviews where 7B drops ' +
      'context.',
  },

  // ─── generalists ──────────────────────────────────────────────────────────
  {
    tag: 'llama3.1:8b',
    params: '8B',
    runtimeRamGB: 5.5,
    diskSizeGB: 4.9,
    role: 'generalist',
    endpoint: 'generate',
    notes:
      'Existing generalist. Used for changelog and status summarization; ' +
      'kept as a fallback when newer models OOM or stall.',
  },
  {
    tag: 'qwen3:14b',
    params: '14B',
    runtimeRamGB: 9.3,
    diskSizeGB: 9.3,
    role: 'generalist',
    endpoint: 'chat',
    emitsThinkingByDefault: true,
    notes:
      'Strongest 14B-class generalist on M1 Pro. Emits chain-of-thought by ' +
      'default — call via /api/chat with think:false (or prefix prompts with ' +
      '/no_think) to keep latency low. Reach for it on harder reasoning that ' +
      'we currently route to Claude Sonnet.',
  },
  {
    tag: 'mistral-nemo:12b',
    params: '12B',
    runtimeRamGB: 7.0,
    diskSizeGB: 7.1,
    role: 'long-context',
    endpoint: 'generate',
    notes:
      '128k context window. Use for whole-file summarization or long memory ' +
      'rollups where stuffing the prompt into a 32k window would truncate. ' +
      'NOTE: pull on demand — not yet pre-pulled by LAI-001.',
  },

  // ─── reasoning ────────────────────────────────────────────────────────────
  {
    tag: 'phi4',
    params: '14B',
    runtimeRamGB: 9.1,
    diskSizeGB: 9.1,
    role: 'reasoning',
    endpoint: 'generate',
    notes:
      'Microsoft Phi-4. GPT-4o-mini-class on MATH and GPQA benchmarks. ' +
      'Reach for it on STEM / formal-reasoning tasks; weaker on raw code ' +
      'generation than the qwen2.5-coder family.',
  },

  // ─── embeddings ───────────────────────────────────────────────────────────
  {
    tag: 'nomic-embed-text',
    params: '137M',
    runtimeRamGB: 0.3,
    diskSizeGB: 0.27,
    role: 'embeddings',
    endpoint: 'embeddings',
    notes:
      'Default embeddings model. 768-dim output, fast (sub-100ms on M1 Pro). ' +
      'Used by LAI-003 (@chiefaia/local-rag) and LAI-004 (@chiefaia/llm-cache).',
  },
];

/** Index models by tag for O(1) lookup. */
const _byTag = new Map<string, LocalModel>(
  MODEL_CATALOG.map((m) => [m.tag, m]),
);

/** Look up a model by its Ollama tag. Returns undefined if unknown. */
export function getModel(tag: string): LocalModel | undefined {
  return _byTag.get(tag);
}

/** Return all catalog entries with a given role. */
export function modelsByRole(role: ModelRole): LocalModel[] {
  return MODEL_CATALOG.filter((m) => m.role === role);
}

/**
 * Total runtime RAM if every catalog model were loaded simultaneously.
 * Useful for a "fits-on-this-machine?" sanity check.
 */
export function totalRuntimeRamGB(): number {
  return MODEL_CATALOG.reduce((sum, m) => sum + m.runtimeRamGB, 0);
}

/**
 * Hardware budget M1 Pro 16GB unified RAM, leaving ~5 GB for OS + editor.
 * Used by tests to detect catalog drift past the hardware ceiling.
 */
export const M1_PRO_USABLE_MODEL_RAM_GB = 11;
