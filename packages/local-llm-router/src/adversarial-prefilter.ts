// RR-1 fast mitigation (2026-05-15): pre-classifier screen that catches
// the four bypass families surfaced by the overnight sps-hardening-routing-rules
// adversarial corpus — instruction-override, role-play escape, system-prompt
// extraction, and JSON-mode hijack — plus a small literal ban-list.
//
// Why a regex pre-screen instead of a model: the overnight cross-test showed
// the 7B classifier mis-routes 50% of these prompts to local. Until the
// LoRA-gated escalator lands (calendar-gated, phase 4+), we need a cheap
// deterministic gate that fails closed. Patterns are intentionally narrow
// to keep the false-positive rate on benign prompts at ~0; widen via the
// eval corpus, not by tightening here.
//
// On match, the router routes the prompt to claude (escalation, not reject)
// and stamps a `RouterDecision` with reason=adversarial-rejected so the
// dashboard surfaces the rate.

export interface AdversarialScreenResult {
  blocked: boolean;
  reason?: string;
  matched?: string;
}

interface Pattern {
  name: string;
  family: 'instruction-override' | 'role-play-escape' | 'prompt-leak' | 'json-hijack' | 'ban-list';
  test: RegExp;
}

// Patterns are case-insensitive and matched against the raw prompt text.
// Keep this set small (10–15) — every entry trades false-positive risk on
// benign prompts. Additions land via eval corpus, not by intuition.
const PATTERNS: Pattern[] = [
  // ── instruction-override ────────────────────────────────────────────
  { name: 'override-ignore-previous',
    family: 'instruction-override',
    test: /\bignore\s+(?:the\s+)?(?:previous|above|prior|earlier)\s+(?:instructions?|prompts?|messages?|rules?)\b/i },
  { name: 'override-disregard',
    family: 'instruction-override',
    test: /\b(?:disregard|forget)\s+(?:the\s+|all\s+|any\s+)?(?:previous|above|prior|earlier|all|prior)?\s*(?:instructions?|prompts?|rules?|guidelines?)\b/i },
  { name: 'override-new-instructions',
    family: 'instruction-override',
    test: /\b(?:new|updated|revised)\s+instructions?\s*[:-]/i },

  // ── role-play escape ────────────────────────────────────────────────
  { name: 'roleplay-pretend-you-are',
    family: 'role-play-escape',
    test: /\bpretend\s+(?:that\s+)?you\s+(?:are|were|have\s+no)\b/i },
  { name: 'roleplay-as-if-you-were',
    family: 'role-play-escape',
    test: /\bas\s+if\s+you\s+(?:were|had|have)\s+(?:no\s+)?(?:rules?|restrictions?|guidelines?|instructions?)\b/i },
  { name: 'roleplay-act-as',
    family: 'role-play-escape',
    test: /\b(?:act|behave|respond)\s+as\s+(?:an?\s+)?(?:DAN|jailbroken|uncensored|unrestricted|unfiltered)\b/i },

  // ── prompt-leak / system-prompt extraction ──────────────────────────
  { name: 'leak-print-system-prompt',
    family: 'prompt-leak',
    test: /\b(?:print|show|display|reveal|repeat|output|return)\s+(?:the\s+|your\s+|me\s+(?:the\s+|your\s+)?)?(?:system\s+prompt|initial\s+instructions?|hidden\s+instructions?)\b/i },
  { name: 'leak-reveal-instructions',
    family: 'prompt-leak',
    test: /\breveal\s+your\s+(?:instructions?|rules?|guidelines?|system\s+message)\b/i },
  { name: 'leak-what-were-you-told',
    family: 'prompt-leak',
    test: /\bwhat\s+(?:were|are)\s+you\s+(?:told|instructed|programmed)\s+(?:to|not\s+to)\b/i },

  // ── JSON-mode hijack ────────────────────────────────────────────────
  { name: 'json-hijack-output-only',
    family: 'json-hijack',
    test: /\boutput\s+only\s+(?:valid\s+)?json\s+(?:with|containing|that\s+(?:has|contains))\b/i },
  { name: 'json-hijack-respond-only-json',
    family: 'json-hijack',
    test: /\b(?:respond|reply|answer)\s+only\s+(?:in|with)\s+(?:valid\s+)?json\s+(?:and\s+(?:nothing|no\s+other)|with\s+(?:fields?|keys?))\b/i },

  // ── literal ban-list (exact-phrase, case-insensitive) ───────────────
  { name: 'ban-jailbreak-token',
    family: 'ban-list',
    test: /\b(?:enable\s+developer\s+mode|do\s+anything\s+now|sudo\s+mode\s+on)\b/i },
  { name: 'ban-bypass-safety',
    family: 'ban-list',
    test: /\bbypass\s+(?:your\s+)?(?:safety|content|moderation)\s+(?:filters?|guidelines?|rules?)\b/i },
];

/**
 * Screen a prompt for known adversarial injection patterns.
 *
 * Returns `{ blocked: false }` on the happy path. When blocked, callers
 * (the router) should escalate the request to Claude rather than the local
 * model and emit a RouterDecision with reason=adversarial-rejected.
 *
 * Performance: O(n × p) regex passes where n = prompt length, p = pattern
 * count (~13). Sub-millisecond on prompts up to ~16KB; safe to call inline
 * on the dispatch path.
 */
export function screenForInjection(prompt: string): AdversarialScreenResult {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { blocked: false };
  }
  for (const p of PATTERNS) {
    if (p.test.test(prompt)) {
      return {
        blocked: true,
        reason: p.family,
        matched: p.name,
      };
    }
  }
  return { blocked: false };
}

/** Test-only: expose the pattern count so the unit test can guard against
 *  accidental shrinkage of the rule set. */
export function __patternCount(): number {
  return PATTERNS.length;
}
