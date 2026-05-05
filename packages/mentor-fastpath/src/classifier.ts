/**
 * Regex-based classifier for OperatorCorrection text.
 *
 * Maps the free-form text of an operator correction to one of the 18
 * failure-mode categories from `mentor_agent_directive.md`. Pure
 * function with no side effects; safe to run on every event.
 *
 * Phase-1 design choice: regex-only. LLM verification (via Ollama) is a
 * Phase-1b enhancement that wraps this classifier — the LLM is only
 * consulted when this module returns `Unclassified` or when severity is
 * high (where a wrong category would have outsized cost).
 *
 * Adding a new pattern: append a `RuleSpec` to RULES below. Patterns are
 * tested top-to-bottom; the FIRST match wins. Order rules from most
 * specific (e.g. distinct phrases) to most general (e.g. single
 * keywords). Add at least one positive + one negative test in
 * tests/classifier.test.ts.
 *
 * The seed lessons from the directive ($Sample seed lessons) provide
 * canonical examples for each category — those are the test fixtures.
 */

import type {
  ClassificationResult,
  FailureMode,
  Generalizability,
  OperatorCorrectionInput,
  Severity
} from './types.js';

/**
 * One classifier rule. The first matching rule wins, so order matters
 * (RULES is iterated top-down).
 *
 * The pattern is matched against `correctionText.toLowerCase()` to keep
 * the rules case-insensitive without requiring `/i` on every pattern. To
 * match against the operator-supplied `context` instead, set
 * `target: 'context'`.
 */
interface RuleSpec {
  pattern: RegExp;
  primary: FailureMode;
  /**
   * Secondary tags (non-primary categories that are also implicated).
   * Phase-1 keeps secondary minimal — most rules just have the primary.
   */
  secondary?: FailureMode[];
  /** Severity hint. Default 'medium' if omitted. */
  severity?: Severity;
  /** Generalizability hint. Default 'unknown'. */
  generalizability?: Generalizability;
  /** Which field to match against. Default 'text'. */
  target?: 'text' | 'context';
}

/**
 * The Phase-1 classifier table. Patterns derived from:
 *   - `mentor_agent_directive.md` ## Failure-mode taxonomy + ## Sample seed lessons
 *   - The leg-3 lesson set in the leg-3 handoff doc (2026-05-04)
 *   - The 2026-05-03 + 2026-05-04 feedback files in agent/memory/
 *
 * Rules are intentionally loose for Phase-1: false-positives surface as
 * 'review-needed' downstream; false-negatives fall through to the
 * `Unclassified` bucket which the Phase-1b LLM-verify path handles.
 */
const RULES: RuleSpec[] = [
  // 13. Decision-classifier violation — most specific phrasings first.
  {
    pattern:
      /\b(stop|don'?t)\s+(asking|presenting)|\b(want me to|should i|your call|do you want|let me know if|would you like)\b/,
    primary: 'DecisionClassifierViolation',
    severity: 'medium',
    generalizability: 'systemic'
  },
  // 12. Re-litigation — operator says 'we already decided', 'see X.md'
  {
    pattern:
      /\b(already|previously|we|already settled|we already|we'?ve already|we did this)\s+(decided|settled|discussed|agreed|covered)\b|\bsee\s+\w+\.md\b|\bre-?litigat/,
    primary: 'ReLitigation',
    secondary: ['MemoryDrift'],
    severity: 'high',
    generalizability: 'systemic'
  },
  // 15. False-modesty — operator pushes back on "I can't" / "only you can"
  {
    pattern:
      /\b(yes you can|you actually can|you do have|of course you can)\b|\bonly\s+you\s+can\b|\b(you can'?t|i can'?t)\b.*\b(actually|but)\b/,
    primary: 'FalseModesty',
    severity: 'medium',
    generalizability: 'systemic'
  },
  // 7. Git/branch hygiene
  {
    pattern:
      /\b(orphan|stale|leftover)\s+(branch|stash|worktree)\b|\bforce[- ]push\b|\bback[- ]merge\b|\b(stash|branch|worktree)\b.*\bnever (merged|cleaned|cleared)\b/,
    primary: 'GitHygieneFailure',
    severity: 'medium'
  },
  // 17. Tool misuse — wrong tier
  {
    pattern:
      /\b(use|prefer)\s+(the\s+)?mcp\b|\bdedicated mcp\b|\bweb[- ]?fetch\b.*\binstead\b|\bcomputer use\b.*\binstead\b/,
    primary: 'ToolMisuse',
    severity: 'low',
    generalizability: 'systemic'
  },
  // 9. Security regression — paired with credential / secret references
  {
    pattern: /\b(secret|credential|token|api[- ]?key|leak)\b.*\b(leaked|exposed|wrong)\b/,
    primary: 'SecurityRegression',
    severity: 'high'
  },
  // 1. Hallucination
  {
    pattern:
      /\bhallucin\w*|\bfabricat\w*|\bmade[- ]up\b|\bthat (file )?doesn'?t exist\b|\bnever existed\b|\b(that'?s|isn'?t)\s+(not\s+)?real\b/,
    primary: 'Hallucination',
    severity: 'high'
  },
  // 11. Premature completion — claims done but isn't
  {
    pattern:
      /\b(not (?:actually )?done|claimed (?:it'?s )?done but|isn'?t done|premature|not finished|tests didn'?t (?:run|pass)|test wasn'?t run|pr wasn'?t merged|file wasn'?t (?:written|created))\b/,
    primary: 'PrematureCompletion',
    severity: 'high'
  },
  // 18. CI flake mistaken for real
  {
    pattern: /\b(flake|flaky|intermittent)\b.*\b(real (bug|failure)|chase|chasing)\b|\bphantom (bug|failure)\b/,
    primary: 'CIFlakeAsRealFailure',
    severity: 'low'
  },
  // 8. Cost overrun
  {
    pattern: /\b(spend|spending|budget|burn|burned)\b.*\b(over|exceed|spike|too much|out of)\b|\b(over|exceed|exceeding|out of|out-of)\s+(budget|spend|spending|cap|limit)\b|\bsubscription bucket\b/,
    primary: 'CostOverrun',
    secondary: ['CoordinationFailure'],
    severity: 'medium'
  },
  // 6. Coordination failure
  {
    pattern:
      /\b(too many|over[- ]?parallel|chaos|stomp|trampl|conflict|conflic)/,
    primary: 'CoordinationFailure',
    severity: 'medium'
  },
  // 14. Memory drift / not consulted
  {
    pattern: /\b(memory|feedback file|memory entry|directive)\b.*\b(ignored|missed|didn'?t (?:read|consult)|forgot|skipped)\b/,
    primary: 'MemoryDrift',
    severity: 'high',
    generalizability: 'systemic'
  },
  // 5. Lacking information
  {
    pattern: /\b(should have (asked|checked|read|looked|probed)|didn'?t (ask|check|read|look|probe)|missed.*context)\b/,
    primary: 'LackingInformation',
    severity: 'medium'
  },
  // 16. Recipe rot
  {
    pattern: /\b(out of date|outdated|stale|wrong)\b.*\b(doc|guide|recipe|runbook|readme|instruction)\b|\b(doc|guide|recipe|runbook|readme|instruction)\b.*\b(out of date|outdated|stale|wrong)\b/,
    primary: 'RecipeRot',
    severity: 'low'
  },
  // 4. Wrong direction — about whole approach
  {
    pattern: /\b(wrong direction|wrong approach|whole approach|pivot|start over|backtrack)\b/,
    primary: 'WrongDirection',
    secondary: ['ScopeMismatch'],
    severity: 'high'
  },
  // 2. Scope mismatch — work doesn't match brief
  {
    pattern: /\b(scope|brief)\b.*\b(mismatch|wrong|didn'?t match|drift)\b|\bnot what (i|we) asked\b/,
    primary: 'ScopeMismatch',
    severity: 'medium'
  },
  // 3. Incompleteness — DoD not met
  {
    pattern: /\b(definition of done|dod|incomplete|partial(ly)? (done|complete)|missed.*step)\b/,
    primary: 'Incompleteness',
    severity: 'medium'
  },
  // 10. Operator confusion (broadest — last)
  {
    pattern: /\b(confusing|misleading|unclear|don'?t understand|misled|wrong (information|info))\b/,
    primary: 'OperatorConfusion',
    severity: 'low'
  }
];

/**
 * Classify an OperatorCorrection event payload.
 *
 * Always returns a result; never throws. If no rule matches, returns the
 * `Unclassified` sentinel (severity='medium', confidence=0) so the
 * downstream synthesizer can route to LLM verification.
 *
 * The classifier is order-sensitive: the first matching rule in RULES
 * wins. If multiple rules might apply, attach the others as secondary
 * tags by listing them on the rule that wins.
 */
export function classifyCorrection(input: OperatorCorrectionInput): ClassificationResult {
  const text = (input.correctionText ?? '').toLowerCase();
  const context = (input.context ?? '').toLowerCase();

  for (const rule of RULES) {
    const haystack = rule.target === 'context' ? context : text;
    if (rule.pattern.test(haystack)) {
      return {
        primary: rule.primary,
        secondary: rule.secondary ?? [],
        severity: rule.severity ?? 'medium',
        generalizability: rule.generalizability ?? 'unknown',
        matchedBy: rule.pattern.source,
        confidence: 1.0
      };
    }
  }

  return {
    primary: 'Unclassified',
    secondary: [],
    severity: 'medium',
    generalizability: 'unknown',
    matchedBy: 'fallback',
    confidence: 0.0
  };
}

/**
 * Test-only helper that returns the count of classifier rules. Useful
 * for asserting in tests that a new rule was actually added (regression
 * guard against accidentally deleting rules during a refactor).
 */
export function _ruleCount(): number {
  return RULES.length;
}
