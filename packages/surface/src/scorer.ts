/**
 * Importance scorer — Phase 0 heuristic.
 *
 *   score = 0.4 * recency
 *         + 0.3 * tag_weight
 *         + 0.2 * severity_weight
 *         + 0.1 * size_signal
 *
 * Deterministic. Stateless. No LLM. Bounded to [0, 1].
 */

import type {
  Finding,
  ImportanceScorer,
  ScoringContext
} from './types.js';

const HIGH_TAGS = new Set([
  'feedback',
  'directive',
  'live',
  'complete',
  'failure',
  'index'
]);

const KEYWORD_BUMPS: ReadonlyArray<{ re: RegExp; bump: number }> = [
  { re: /\bBLOCK(?:ED|ER)\b/i, bump: 0.6 },
  { re: /\bCRITICAL\b/i, bump: 0.5 },
  { re: /\bFAIL(?:ED|URE)\b/i, bump: 0.4 },
  { re: /🚨/u, bump: 0.5 },
  { re: /\bsecurity\b/i, bump: 0.4 },
  { re: /\bcomplete(?:d|s)?\b/i, bump: 0.3 },
  { re: /\bphase\s?\d+\b/i, bump: 0.2 },
  { re: /\bmerged\b/i, bump: 0.15 }
];

const SEVERITY_KIND_WEIGHT: Readonly<Record<string, number>> = {
  'pr-merged': 0.7,
  'pr-opened': 0.5,
  'pr-stale': 0.85,
  'memory-added': 0.6,
  'memory-updated': 0.5,
  'transcript-handoff': 0.4,
  'transcript-failure': 0.85,
  'connector-degraded': 0.3
};

/** Default scorer instance. Stateless. */
export const defaultScorer: ImportanceScorer = {
  score(finding, ctx) {
    return clamp01(
      0.4 * recencyComponent(finding.tsIso, ctx) +
      0.3 * tagComponent(finding.tags, finding.title) +
      0.2 * severityComponent(finding.kind) +
      0.1 * sizeComponent(finding)
    );
  }
};

export function applyScores(
  findings: ReadonlyArray<Omit<Finding, 'importance'>>,
  ctx: ScoringContext,
  scorer: ImportanceScorer = defaultScorer
): readonly Finding[] {
  return findings.map(f => ({
    ...f,
    importance: scorer.score(f, ctx)
  }));
}

function recencyComponent(tsIso: string, ctx: ScoringContext): number {
  const tMs = Date.parse(tsIso);
  const sinceMs = Date.parse(ctx.sinceIso);
  const untilMs = Date.parse(ctx.untilIso);
  if (Number.isNaN(tMs) || Number.isNaN(sinceMs) || Number.isNaN(untilMs)) return 0.5;
  const span = untilMs - sinceMs;
  if (span <= 0) return 1.0;
  const offset = tMs - sinceMs;
  const ratio = clamp01(offset / span);
  // Linear: 0.0 at older horizon edge, 1.0 at the freshest moment.
  return ratio;
}

function tagComponent(tags: readonly string[], title: string): number {
  let weight = 0;
  for (const t of tags) {
    if (HIGH_TAGS.has(t)) weight += 0.35;
    else weight += 0.05;
  }
  for (const { re, bump } of KEYWORD_BUMPS) {
    if (re.test(title)) weight += bump;
  }
  return clamp01(weight);
}

function severityComponent(kind: string): number {
  return SEVERITY_KIND_WEIGHT[kind] ?? 0.3;
}

function sizeComponent(finding: Pick<Finding, 'meta' | 'bodyExcerpt'>): number {
  const m = finding.meta;
  let bytes = finding.bodyExcerpt?.length ?? 0;
  if (m !== undefined) {
    const sb = m['sizeBytes'];
    if (typeof sb === 'number') bytes = Math.max(bytes, sb);
  }
  if (bytes <= 0) return 0;
  return clamp01(Math.log10(bytes + 1) / 5);
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
