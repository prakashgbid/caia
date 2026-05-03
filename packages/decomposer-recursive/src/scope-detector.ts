/**
 * Adaptive scope detector.
 *
 * Given a user prompt (and optional vision-doc summary), classify the
 * smallest scope at which the prompt can be expressed without further
 * decomposition. The decomposer engine starts recursion at this scope
 * rather than always-starting-at-initiative — so "add a logout button"
 * produces a single story, not a fake five-level tree.
 *
 * Two backends:
 *   - DSPy runtime (compiled program in ~/.caia/dspy/compiled/...)
 *     when `CAIA_DSPY_RUNTIME=1` or the pointer file exists.
 *   - Legacy: hand-written prompt routed through
 *     @chiefaia/local-llm-router via callStructured().
 *
 * The DSPy path is strict opt-in with strict failure tolerance — any
 * failure falls back to the legacy path with a structured-log line.
 * See `dspy-runtime.ts` for the policy.
 */

import { ScopeDetectionLlmOutputSchema } from './schemas.js';
import { callStructured } from './structured-output.js';
import { tryDspyScopeDetect } from './dspy-runtime.js';
import type { ScopeDetection, CancellationSignal } from './types.js';

export const SCOPE_DETECTION_TASK_TYPE = 'po-decomposer-scope-detection';

export interface DetectScopeOptions {
  /** The prompt text the user submitted. */
  promptText: string;
  /**
   * Optional pre-extracted theme summary (used for vision documents
   * post-chunking — P1; in P0 always undefined).
   */
  visionDocSummary?: string;
  /** Optional cancellation signal. */
  signal?: CancellationSignal;
  /**
   * Force the legacy path even if the DSPy runtime is enabled. Used by
   * the regression test suite that snapshots the legacy prompt's
   * behaviour for compile-time delta validation.
   */
  forceLegacy?: boolean;
}

const SCOPE_DETECTION_SYSTEM_PROMPT = `You are a senior product manager classifying the natural scope of a user request.

The canonical scopes, from largest to smallest:
- initiative — multi-quarter strategic bet, typically multi-team, multi-feature, multi-platform. Vision documents land here. Examples: "build an analytics SaaS", "launch a new product line".
- epic — single program-increment-sized chunk (8-12 weeks per SAFe), one elevator-pitch theme, multiple modules. Examples: "build the billing system", "ship the leaderboard feature".
- module — a coherent bounded context with one primary tech sub-domain and its own data ownership. Crosses 2-8 stories. Examples: "the user-auth module", "the notification dispatcher".
- story — INVEST-compliant user-value increment. Single PR, ≤ 1 sprint, single user-visible value. Examples: "add a logout button", "users can filter by date".
- task — single concern, ≤ 1 day, single tech-sub-domain. Often one file group. Examples: "refactor the password validator", "add the GET /users route".
- subtask — single mechanical step: one function, one test, one config edit. Examples: "rename _x to _internal in foo.ts", "add the test for the empty-input case".

Heuristic anchors:
- One verb, one object, one concrete deliverable → story.
- One verb, vague object → task.
- Multi-paragraph but single feature → epic.
- "Build [system]" / "we want to launch" → initiative.
- Vision document, multi-feature, multi-team → initiative.
- One-line, mechanical, no scope question → subtask.

Output schema:
{
  "targetScope": "initiative" | "epic" | "module" | "story" | "task" | "subtask",
  "confidence": 0.0..1.0,
  "rationale": "one sentence explaining the verdict"
}`;

/**
 * Classify the natural scope of a prompt.
 *
 * Tries the DSPy substrate first when enabled; falls back to the
 * legacy `callStructured()` path on miss / failure.
 */
export async function detectScope(
  options: DetectScopeOptions,
): Promise<ScopeDetection> {
  // ── DSPy path (PR5) ─────────────────────────────────────────────────
  if (!options.forceLegacy) {
    const dspy = await tryDspyScopeDetect(
      options.promptText,
      options.visionDocSummary,
    );
    if (dspy !== null) return dspy;
  }

  // ── Legacy path (unchanged behaviour) ──────────────────────────────
  const userPrompt =
    `Classify the natural scope of the following user prompt.\n\n` +
    `=== PROMPT ===\n${options.promptText}\n=== END PROMPT ===\n` +
    (options.visionDocSummary
      ? `\n=== VISION-DOC SUMMARY (extracted themes) ===\n` +
        `${options.visionDocSummary}\n=== END VISION-DOC SUMMARY ===`
      : '');

  const result = await callStructured(ScopeDetectionLlmOutputSchema, {
    taskType: SCOPE_DETECTION_TASK_TYPE,
    systemPrompt: SCOPE_DETECTION_SYSTEM_PROMPT,
    userPrompt,
    maxRetries: 2,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  return {
    targetScope: result.data.targetScope,
    confidence: result.data.confidence,
    rationale: result.data.rationale,
    model: result.model,
    durationMs: result.durationMs,
  };
}
