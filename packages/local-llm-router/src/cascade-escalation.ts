// R-1 fix (2026-05-15): post-dispatch cascade escalation. After the local
// model returns, decide whether the response itself signals that the call
// should have gone to claude. The pre-classifier adversarial-prefilter only
// catches injection-shaped prompts; this module catches the other half — the
// local model accepted a benign prompt but produced low-confidence or
// schema-broken output.
//
// Triggers (in order of detection):
//   1. Empty / too-short: trimmed response < MIN_RESPONSE_CHARS. Usually
//      indicates a hard refusal that bottomed out as ".", "\n", or "I" or
//      a generation budget that hit a stop token immediately.
//   2. Explicit `needs_escalation: true`: classifier-style tasks emit this
//      flag in their JSON output (see classifier.ts / classifier-v2.ts). When
//      the local model itself recommends escalation, honor it.
//   3. JSON-parse failure on JSON-shaped output: if the response looks like
//      a JSON object/array (starts and ends with matching brackets) but
//      JSON.parse throws, the schema contract is broken. Escalate.
//   4. Refusal / low-confidence prose: small set of strict regexes for the
//      canonical refusal openers ("i don't know", "sorry, i cannot", "as an
//      ai language model", "insufficient information", "unable to
//      determine"). Patterns are intentionally narrow — false-positive risk
//      on legitimate prose; widen via eval corpus, not by intuition.
//
// On match the router routes the prompt to claude and stamps a
// RouterDecision with reason=cascade-escalation:<trigger> so the dashboard
// surfaces the rate. Mirrors the adversarial-prefilter ergonomics on
// purpose — same result shape, same emit contract.

import type { LLMResponse } from './types.js';

export interface CascadeEscalationResult {
  shouldEscalate: boolean;
  reason?: string;
  trigger?: 'empty-or-short' | 'explicit-needs-escalation' | 'json-parse-fail' | 'refusal';
}

const MIN_RESPONSE_CHARS = 8;

interface RefusalPattern {
  name: string;
  test: RegExp;
}

const REFUSAL_PATTERNS: RefusalPattern[] = [
  {
    name: 'i-dont-know',
    test: /\bi\s+(?:do\s+not|don'?t)\s+know\b/i,
  },
  {
    name: 'sorry-i-cannot',
    test: /\b(?:sorry,?\s+)?i\s+(?:can'?t|cannot|am\s+unable|'?m\s+unable)\s+(?:help|assist|do\s+that|provide|answer|complete|fulfill)\b/i,
  },
  {
    name: 'as-an-ai',
    test: /\b(?:as\s+an?\s+ai(?:\s+language\s+model)?|i'?m\s+just\s+an\s+ai|as\s+a\s+language\s+model)\b/i,
  },
  {
    name: 'insufficient-information',
    test: /\b(?:insufficient|not\s+enough)\s+(?:information|context|data|detail)\b/i,
  },
  {
    name: 'unable-to-determine',
    test: /\bunable\s+to\s+(?:determine|answer|provide|complete|generate)\b/i,
  },
];

/**
 * Decide whether a local-model response should be re-dispatched to claude.
 *
 * Returns `{ shouldEscalate: false }` on the happy path. When true, the
 * caller (router) should re-dispatch the same request to claude and emit a
 * RouterDecision with reason=cascade-escalation:<trigger>.
 *
 * Pure function, no side effects. Safe to call on every dispatch.
 */
export function shouldEscalate(response: LLMResponse): CascadeEscalationResult {
  const raw = typeof response.response === 'string' ? response.response : '';
  const text = raw.trim();

  // 1) Empty / too-short
  if (text.length < MIN_RESPONSE_CHARS) {
    return {
      shouldEscalate: true,
      trigger: 'empty-or-short',
      reason: `length=${text.length}`,
    };
  }

  // 2) Explicit needs_escalation signal — the classifier emits this in its
  //    JSON output when it thinks the task is beyond a 7B coder's capability.
  if (/"needs_escalation"\s*:\s*true/i.test(text)) {
    return {
      shouldEscalate: true,
      trigger: 'explicit-needs-escalation',
      reason: 'classifier-flagged',
    };
  }

  // 3) JSON-parse failure on JSON-shaped output. Only attempt the parse when
  //    the response visually looks like JSON to avoid false positives on
  //    legitimate prose that happens to contain stray braces.
  const first = text.charAt(0);
  const last = text.charAt(text.length - 1);
  if ((first === '{' && last === '}') || (first === '[' && last === ']')) {
    try {
      JSON.parse(text);
    } catch (e) {
      return {
        shouldEscalate: true,
        trigger: 'json-parse-fail',
        reason: (e as Error).message.slice(0, 80),
      };
    }
  }

  // 4) Refusal / low-confidence phrases
  for (const p of REFUSAL_PATTERNS) {
    if (p.test.test(text)) {
      return {
        shouldEscalate: true,
        trigger: 'refusal',
        reason: p.name,
      };
    }
  }

  return { shouldEscalate: false };
}

/** Test-only: expose refusal-pattern count for tests that guard against
 *  accidental shrinkage of the rule set. */
export function __refusalPatternCount(): number {
  return REFUSAL_PATTERNS.length;
}
