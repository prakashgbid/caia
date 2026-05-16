// Intent classifier — uses qwen2.5-coder:7b (or future Apprentice LoRA) via Ollama
// to classify incoming prompts into a constrained-JSON intent schema.
//
// L5 of the Local-LLM-First build plan. Inline implementation rather than a
// separate @chiefaia/intent-schemas package — keeps the MVP single-package.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { OllamaAdapter as _OllamaAdapterRef } from './ollama-adapter.js';

export type Intent =
  | 'classify'
  | 'summarize'
  | 'doc-summarize'
  | 'draft-prose'
  | 'prose-rewrite'
  | 'format'
  | 'format-convert'
  | 'lint-fix'
  | 'rename'
  | 'fill-template'
  | 'memory-search'
  | 'small-code-edit'
  | 'code-explain'
  | 'doc-update'
  | 'extract'
  | 'error-recovery'
  | 'medium-code'
  | 'doc-write'
  | 'spec-check'
  | 'review-prose'
  | 'code-review'
  | 'test-gen'
  | 'schema-design'
  | 'hard-code'
  | 'refactor-complex'
  | 'architecture'
  // A.9.7 — new intents (2026-05-14). Decoupled from the design-
  // oriented `architecture` and `research-synthesis` labels because
  // *review* and *summary* are distinct shapes: `architecture-review`
  // critiques an existing design, `research-summary` condenses
  // existing research into actionable bullets (not synthesizes new).
  | 'architecture-review'
  | 'research-summary'
  | 'reason-over-context'
  | 'new-design'
  | 'architect'
  | 'research-synthesis'
  | 'batch-summarize'
  | 'corpus-distill'
  | 'long-context-reason'
  | 'embedding-generate'
  // RR-2 — canonical-suite-v2 expected_intent vocab (2026-05-15).
  // The eval suite (evals/canonical-suite-v2.yaml) uses *coarse* intent
  // labels (edit / review / explain / prose-draft / search) that the
  // classifier used to coerce to `unknown` → `claude` because they
  // weren't in INTENT_VALUES. That caused legitimate prompts to fall to
  // the default (escalate-to-claude) tier on every eval row in the
  // code-edit-*, code-review, code-explain, prose-draft, search-memory
  // categories — exactly the silent-default-tier-fall symptom the canonical
  // suite was designed to catch. These are first-class intents now so the
  // model can emit them; the fine-grained variants (small-code-edit,
  // code-review, code-explain, draft-prose, memory-search) remain valid
  // and are preferred when the spec is unambiguously specific. The three
  // safety/edge intents (ambiguous, empty, prompt-injection) round out
  // the canonical-suite-v2 expected_intent set — they route to claude
  // (= the eval's reject / cloud-haiku conservative-escalate behavior).
  | 'edit'
  | 'explain'
  | 'review'
  | 'prose-draft'
  | 'search'
  | 'ambiguous'
  | 'empty'
  | 'prompt-injection'
  | 'unknown';

export type RecommendedTier = 'local-7b' | 'local-14b' | 'local-32b' | 'claude' | 'stolution-batch';

export interface IntentResult {
  intent: Intent;
  confidence: number;          // 0..1
  needs_escalation: boolean;
  recommended_tier: RecommendedTier;
  reasoning: string;
}

export const INTENT_VALUES: ReadonlyArray<Intent> = [
  'classify', 'summarize', 'doc-summarize', 'draft-prose', 'prose-rewrite',
  'format', 'format-convert', 'lint-fix', 'rename', 'fill-template',
  'memory-search', 'small-code-edit', 'code-explain', 'doc-update', 'extract',
  'error-recovery', 'medium-code', 'doc-write', 'spec-check', 'review-prose',
  'code-review', 'test-gen', 'schema-design', 'hard-code', 'refactor-complex', 'architecture',
  // A.9.7 (2026-05-14).
  'architecture-review', 'research-summary',
  'reason-over-context', 'new-design', 'architect', 'research-synthesis',
  'batch-summarize', 'corpus-distill', 'long-context-reason',
  'embedding-generate',
  // RR-2 (2026-05-15) — canonical-suite-v2 expected_intent vocab.
  'edit', 'explain', 'review', 'prose-draft', 'search',
  'ambiguous', 'empty', 'prompt-injection',
  'unknown',
];

/**
 * RR-2 (2026-05-15) — canonical-suite-v2 expected_intent vocab.
 *
 * The 20 intent labels used as ground-truth in
 * `evals/canonical-suite-v2.yaml`. Exported so the unit-test guard
 * (`tests/intent-vocab-canonical.test.ts`) can assert that every value
 * in this set is a valid Intent — and that every Intent is backed by a
 * routing-config taskType. The parity-test is the cheap regression
 * tripwire for the silent-default-tier-fall the canonical suite was
 * designed to catch.
 *
 * Source of truth: canonical-suite-v2.yaml `expected_intent` field.
 * Do not edit this list to track classifier additions — add new
 * intents to INTENT_VALUES instead. This set tracks the eval contract.
 */
export const CANONICAL_SUITE_V2_INTENTS: ReadonlyArray<string> = [
  'ambiguous', 'classify', 'doc-update', 'doc-write', 'edit', 'empty',
  'error-recovery', 'explain', 'extract', 'format-convert',
  'prompt-injection', 'prose-draft', 'prose-rewrite', 'refactor-complex',
  'rename', 'review', 'schema-design', 'search', 'summarize', 'test-gen',
];

export const TIER_VALUES: ReadonlyArray<RecommendedTier> = [
  'local-7b', 'local-14b', 'local-32b', 'claude', 'stolution-batch',
];

/** Classifier system prompt. Pins the model to constrained JSON output. */
export const CLASSIFIER_SYSTEM_PROMPT = `You are an intent classifier for the CAIA agent system. You read a task spec and emit STRICT JSON describing what kind of work it requires.

Your output is ONLY a JSON object with these fields, no prose:

{
  "intent": one of [${INTENT_VALUES.join(', ')}],
  "confidence": float 0.0..1.0 (your subjective confidence in the intent label),
  "needs_escalation": boolean (true if the task is beyond a 7B coder model's capability),
  "recommended_tier": one of [${TIER_VALUES.join(', ')}],
  "reasoning": short string (≤120 chars) explaining the classification
}

Tier guidance:
- local-7b: classify, summarize, format, lint-fix, rename, draft-prose, prose-draft, fill-template, memory-search, search, edit, explain
- local-14b: medium-code, doc-write, spec-check, review-prose, review
- local-32b: hard-code requiring deep reasoning over multiple files
- claude: reason-over-context, new-design, architect, ambiguous, empty, prompt-injection, or anything where confidence < 0.6 on a non-code task
- stolution-batch: batch-summarize, corpus-distill, embedding-generate (CPU-OK batch work)

If the task is ambiguous, pick "ambiguous" (or "unknown") with confidence < 0.5 and needs_escalation: true.

Output ONLY the JSON object. No markdown, no prose before or after, no code fences.`;

export interface ClassifyOptions {
  /** Model tag in Ollama; default qwen2.5-coder:7b */
  model?: string;
  /** Override Ollama base URL (defaults to env OLLAMA_BASE_URL or http://127.0.0.1:11434) */
  ollamaBaseUrl?: string;
  /** Hard latency cap in ms */
  timeoutMs?: number;
}

const DEFAULT_MODEL = 'qwen2.5-coder:7b';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Classify a task spec into a constrained intent shape. */
export async function classify(
  taskSpec: string,
  opts: ClassifyOptions = {},
): Promise<IntentResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = opts.ollamaBaseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const userPrompt = `Task spec:\n"""\n${taskSpec}\n"""\n\nClassify this task. Output only the JSON.`;

  // Use Ollama /api/chat with format=json for constrained JSON output
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 400 },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return abstainResult((e as Error).message);
  }
  clearTimeout(timer);

  if (!res.ok) {
    return abstainResult(`ollama returned ${res.status}`);
  }

  const body = (await res.json()) as { message?: { content?: string } };
  const raw = body.message?.content ?? '';
  return parseClassifierOutput(raw);
}

/** Parse the model's JSON output. On any failure, return a safe abstain result. */
export function parseClassifierOutput(raw: string): IntentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return abstainResult(`json-parse-failed: ${raw.slice(0, 80)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return abstainResult('not-an-object');
  }
  const obj = parsed as Record<string, unknown>;
  const intent = (typeof obj.intent === 'string' && (INTENT_VALUES as readonly string[]).includes(obj.intent)
    ? obj.intent : 'unknown') as Intent;
  const confidence = typeof obj.confidence === 'number' && obj.confidence >= 0 && obj.confidence <= 1
    ? obj.confidence : 0.0;
  const needs_escalation = Boolean(obj.needs_escalation);
  const recommended_tier = (typeof obj.recommended_tier === 'string' && (TIER_VALUES as readonly string[]).includes(obj.recommended_tier)
    ? obj.recommended_tier : tierForIntent(intent, confidence)) as RecommendedTier;
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 200) : '';
  return { intent, confidence, needs_escalation, recommended_tier, reasoning };
}

/** Decide tier from intent+confidence when the model didn't supply one. */
export function tierForIntent(intent: Intent, confidence: number): RecommendedTier {
  if (intent === 'embedding-generate' || intent === 'corpus-distill' || intent === 'batch-summarize') {
    return 'stolution-batch';
  }
  // RR-2 (2026-05-15) — canonical-suite-v2 coarse intents are routed to the
  // baseline tier their fine-grained kin land on. `edit` (coarse code-edit
  // covering small/medium/large) defaults to local-7b so the cascade
  // controller has full headroom to promote; `review` covers code-review
  // and review-prose at local-14b; `explain` shadows code-explain;
  // `prose-draft` shadows draft-prose; `search` shadows memory-search.
  // The three safety/edge intents (`ambiguous`, `empty`, `prompt-injection`)
  // route to claude (= eval's reject / cloud-haiku conservative-escalate).
  const lightLocal: ReadonlyArray<Intent> = [
    'classify', 'summarize', 'format', 'lint-fix', 'rename', 'draft-prose',
    'fill-template', 'memory-search',
    // RR-2 coarse aliases (local-7b tier).
    'edit', 'explain', 'prose-draft', 'search',
  ];
  const mediumLocal: ReadonlyArray<Intent> = [
    'medium-code', 'doc-write', 'spec-check', 'review-prose',
    // RR-2 coarse alias (local-14b tier).
    'review',
  ];
  const claudeOnly: ReadonlyArray<Intent> = [
    'ambiguous', 'empty', 'prompt-injection',
  ];
  if (claudeOnly.includes(intent)) return 'claude';
  if (lightLocal.includes(intent) && confidence >= 0.6) return 'local-7b';
  if (mediumLocal.includes(intent) && confidence >= 0.6) return 'local-14b';
  if (intent === 'hard-code') return 'local-32b';
  return 'claude';
}

function abstainResult(reason: string): IntentResult {
  return {
    intent: 'unknown',
    confidence: 0.0,
    needs_escalation: true,
    recommended_tier: 'claude',
    reasoning: `abstain: ${reason}`,
  };
}
