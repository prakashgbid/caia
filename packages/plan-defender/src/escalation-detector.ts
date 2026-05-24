/**
 * Detects the three classes of "Defender cannot answer" cases (spec §3.7):
 *
 *   1. producer-never-decided — context dump lists no decision_point covering
 *      the Reviewer's question.
 *   2. strategic-class-question — touches a principle amendment, billing-model
 *      change, pivot, security-posture change, etc. Reuses the same trigger
 *      vocabulary as @caia/ea-architect/src/escalation.ts.
 *   3. consecutive-low-confidence — three low-confidence answers in a row.
 *
 * The detector returns a normalised classification the Defender or the
 * spawner can act on.
 */

import type {
  DefenderAnswer,
  DefenderEscalationKind,
  DefenderQuestion,
  PlanContextDump
} from './types.js';

/**
 * Vocabulary of strategic-class question fragments. Mirrors
 * ea-architect's STRATEGIC_KEYWORDS but oriented to question text rather
 * than plan-body text.
 */
const STRATEGIC_QUESTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; category: string }> = [
  { pattern: /\bpivot\b|change\s+the\s+product|change\s+direction/i, category: 'product-pivot' },
  { pattern: /\bbilling\b|\bpricing\b|monetiz|paid\s+tier|subscription\s+model/i, category: 'billing-model-change' },
  { pattern: /\bsecurity\s+posture\b|threat\s+model|attack\s+surface|new\s+auth\s+model/i, category: 'security-posture-change' },
  { pattern: /amend\s+(a|the)\s+principle|change\s+(a|the)\s+principle|new\s+principle/i, category: 'principle-amendment' },
  { pattern: /reverse\s+(an?\s+)?adr|rescind\s+(an?\s+)?adr|fundamentally\s+(re)?architect/i, category: 'fundamental-architecture-reversal' },
  { pattern: /strategic\s+direction|company\s+strategy|business\s+strategy/i, category: 'strategic-direction-change' }
];

/** True iff the question text matches one of the strategic-class patterns. */
export function isStrategicQuestion(question: string): { match: true; category: string } | { match: false } {
  for (const { pattern, category } of STRATEGIC_QUESTION_PATTERNS) {
    if (pattern.test(question)) return { match: true, category };
  }
  return { match: false };
}

/**
 * True iff the question is not covered by any decision_point in the dump
 * AND not derivable from any sources_consulted entry's relevance text.
 *
 * Heuristic: lowercased keyword overlap. Imperfect but useful as a
 * tier-1 deterministic check; tier-2 LLM reasoning happens inside the
 * Defender itself when the responder runs.
 */
export function isProducerNeverDecided(question: string, dump: PlanContextDump): boolean {
  const qTokens = tokenize(question);
  if (qTokens.length === 0) return false; // can't decide on empty question

  for (const dp of dump.decision_points) {
    if (overlapScore(qTokens, tokenize(`${dp.decision} ${dp.rationale} ${dp.chosen}`)) >= 0.25) {
      return false;
    }
  }
  for (const src of dump.sources_consulted) {
    if (overlapScore(qTokens, tokenize(`${src.citation} ${src.relevance}`)) >= 0.25) {
      return false;
    }
  }
  for (const alt of dump.alternatives_dropped) {
    if (overlapScore(qTokens, tokenize(`${alt.alternative} ${alt.why_dropped}`)) >= 0.25) {
      return false;
    }
  }
  return true;
}

/**
 * Detect the three-consecutive-low-confidence rule on a running window.
 */
export function isConsecutiveLowConfidence(
  recentAnswers: DefenderAnswer[],
  threshold: number
): boolean {
  if (recentAnswers.length < threshold) return false;
  const tail = recentAnswers.slice(-threshold);
  return tail.every((a) => a.confidence === 'low');
}

/**
 * Composite check — returns the escalation kind to fire, or null.
 *
 * Precedence: strategic > producer-never-decided > consecutive-low-confidence.
 * Iteration-cap-reached is decided by the spawner, not the detector.
 */
export function detectEscalation(args: {
  question: DefenderQuestion;
  recentAnswers: DefenderAnswer[];
  dump: PlanContextDump;
  consecutiveThreshold: number;
}): { kind: DefenderEscalationKind; note: string } | null {
  const strat = isStrategicQuestion(args.question.question);
  if (strat.match) {
    return {
      kind: 'strategic-class-question',
      note: `Strategic-class question (${strat.category}) — Defender cannot decide; producer cannot decide; only the operator can. Escalating immediately.`
    };
  }
  if (isProducerNeverDecided(args.question.question, args.dump)) {
    return {
      kind: 'producer-never-decided',
      note: 'The context dump lists no decision_point covering this question. Producer left it open; the Defender will not fabricate an answer.'
    };
  }
  if (isConsecutiveLowConfidence(args.recentAnswers, args.consecutiveThreshold)) {
    return {
      kind: 'consecutive-low-confidence',
      note: `Three consecutive low-confidence answers indicate the context dump is too thin for this submission. Escalating so the operator or the producing agent can thicken the dump.`
    };
  }
  return null;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'but', 'if', 'then', 'than', 'as', 'because', 'so', 'for',
  'of', 'in', 'on', 'at', 'to', 'from', 'with', 'by', 'about', 'into',
  'over', 'under', 'between', 'through', 'this', 'that', 'these', 'those',
  'it', 'its', 'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your',
  'i', 'me', 'my', 'mine', 'do', 'does', 'did', 'doing', 'have', 'has',
  'had', 'having', 'will', 'would', 'should', 'could', 'can', 'may', 'might',
  'shall', 'must', 'how', 'what', 'why', 'when', 'where', 'which', 'who',
  'whom', 'whose', 'not', 'no', 'yes', 'just', 'also', 'too', 'very'
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bset = new Set(b);
  let hit = 0;
  for (const t of a) if (bset.has(t)) hit++;
  return hit / Math.max(a.length, b.length);
}
