/**
 * Atomicity classifier.
 *
 * After a parent expansion, every candidate child runs through this
 * classifier to decide:
 *   - `atomic = true`  → the recursion stops at this child (it's a leaf).
 *   - `atomic = false` → the child is enqueued for decomposition at the
 *                        next-lower scope.
 *
 * Each scope has its own rubric (proposal §5C). The rubric is sent
 * verbatim to the LLM along with the child ticket; the LLM returns
 * `{ atomic, confidence, rationale, failedCriteria[] }`.
 *
 * Like the scope detector this is a classification task, so the
 * `po-decomposer-atomicity-classification` routing rule prefers
 * Ollama (qwen2.5-coder:7b) with Claude fallback.
 */

import { AtomicityLlmOutputSchema } from './schemas.js';
import { callStructured } from './structured-output.js';
import type {
  AtomicityVerdict,
  CancellationSignal,
  ChildTicket,
  StoryScope,
} from './types.js';

export const ATOMICITY_CLASSIFICATION_TASK_TYPE =
  'po-decomposer-atomicity-classification';

// ─── Per-scope rubrics (proposal §5C) ───────────────────────────────────

/**
 * Rubric per scope. The LLM is asked to evaluate the candidate child
 * against EVERY criterion; `atomic = true` requires every criterion
 * to pass; `failedCriteria[]` lists the criteria that failed when the
 * verdict is `false`.
 */
export const ATOMICITY_RUBRICS: Record<StoryScope, readonly string[]> = {
  initiative: [
    'Single strategic bet (one elevator-pitch theme, one OKR/KPI cluster).',
    'Sized to a single quarter or release-train without further strategic split.',
    'Has 2-5 expected epics under it (else it is a multi-initiative vision).',
  ],
  epic: [
    'Fits a single Program Increment per SAFe (8-12 weeks).',
    'Single dominant value theme expressible in <= 25 words.',
    'Crosses at most 2 modules (else it is an initiative-shaped concern).',
    'Has 2-10 expected stories under it.',
  ],
  module: [
    'Coherent bounded context (DDD) with single primary tech sub-domain.',
    'Owns its data — at least one schema/table/state-store is conceptually under this module.',
    'Has 2-8 stories under it (collapse to story if fewer; split if more).',
    'Has clear API/contract boundary describable in one paragraph.',
  ],
  story: [
    'INVEST-compliant: Independent (or with explicit deps), Negotiable, Valuable, Estimable, Small, Testable.',
    'Sized to a single PR / <= 1 sprint of work.',
    'Touches a single user-visible value increment.',
    'Has 3-6 concrete acceptance criteria, each testable, each >= 8 words.',
    'Atomic-self-check: NO description containing "and"/"also"/"while" coordinating two distinct user concerns.',
  ],
  task: [
    'Single concern (no "and"/"also" coordinating distinct concerns in the description).',
    'Single primary tech sub-domain.',
    'Sized to <= 1 day of work for a competent engineer.',
    'Touches <= 3 files or a single tightly-coupled cluster.',
    'Concrete artifact target: function/class/route/schema name explicitly mentioned or inferable.',
  ],
  subtask: [
    'Single mechanical step (single function, single test, single comment block, single config edit).',
    'Sized to <= 2 hours of work.',
    'Names the precise artifact (function name, test name, file region).',
    'No scope question — implementation is mechanical given the parent task.',
  ],
};

// ─── System prompt ──────────────────────────────────────────────────────

function buildAtomicitySystemPrompt(scope: StoryScope): string {
  const rubric = ATOMICITY_RUBRICS[scope];
  const rubricBlock = rubric.map((c, i) => `  ${String(i + 1)}. ${c}`).join('\n');
  return `You are a senior product manager applying the atomicity rubric for a "${scope}" ticket.

A ${scope} is atomic if and only if EVERY rubric item below passes for the candidate ticket.

Rubric for ${scope}:
${rubricBlock}

Output schema:
{
  "atomic": true | false,
  "confidence": 0.0..1.0,
  "rationale": "one paragraph (<= 80 words) summarising the verdict",
  "failedCriteria": [ "verbatim text of each failing rubric item" ]
}

Hard rules:
- "atomic": true requires "failedCriteria" to be empty.
- "atomic": false requires "failedCriteria" to be non-empty.
- "failedCriteria" entries must be verbatim copies of rubric items above.
- If you are unsure, prefer "atomic": false with a low confidence — the
  recursion will refine. Returning a wrong "atomic": true blocks
  downstream agents from catching a mis-sized ticket.`;
}

function buildAtomicityUserPrompt(child: ChildTicket): string {
  const acLine =
    child.acceptanceCriteria && child.acceptanceCriteria.length > 0
      ? `Acceptance criteria:\n${child.acceptanceCriteria.map((a) => `  - ${a}`).join('\n')}`
      : 'Acceptance criteria: (none)';

  return (
    `Evaluate this candidate ticket against the rubric.\n\n` +
    `Title: ${child.title}\n` +
    `Scope: ${child.scope}\n` +
    `Description: ${child.description}\n` +
    `In scope: ${child.inScope.join('; ') || '(empty)'}\n` +
    `Out of scope: ${child.outOfScope.join('; ') || '(empty)'}\n` +
    `${acLine}\n` +
    `Lifecycle: ${child.lifecycle}\n` +
    `Sibling dependencies: ${child.dependencies.length === 0 ? '(none)' : child.dependencies.join(', ')}`
  );
}

// ─── Entry point ────────────────────────────────────────────────────────

export interface ClassifyAtomicityOptions {
  child: ChildTicket;
  signal?: CancellationSignal;
}

/**
 * Classify whether a candidate child is atomic at its declared scope.
 */
export async function classifyAtomicity(
  options: ClassifyAtomicityOptions,
): Promise<AtomicityVerdict> {
  const { child, signal } = options;

  const result = await callStructured(AtomicityLlmOutputSchema, {
    taskType: ATOMICITY_CLASSIFICATION_TASK_TYPE,
    systemPrompt: buildAtomicitySystemPrompt(child.scope),
    userPrompt: buildAtomicityUserPrompt(child),
    maxRetries: 2,
    ...(signal ? { signal } : {}),
  });

  // Enforce the contract beyond Zod: if the model returned atomic=true
  // with non-empty failedCriteria (or vice versa), force-correct by
  // setting atomic to match the failedCriteria array. Conservative bias
  // toward "not atomic" so the recursion errs on more decomposition,
  // never less.
  let atomic = result.data.atomic;
  const failedCriteria = result.data.failedCriteria;
  if (atomic && failedCriteria.length > 0) {
    atomic = false;
  } else if (!atomic && failedCriteria.length === 0) {
    atomic = true;
  }

  return {
    atomic,
    confidence: result.data.confidence,
    rationale: result.data.rationale,
    failedCriteria,
    model: result.model,
    durationMs: result.durationMs,
  };
}
