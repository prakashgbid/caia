/**
 * Deterministic scripted question bank for the Step 3 Interview wizard
 * page's V1 default path. Mirrors the precedent set by
 * `apps/dashboard/app/api/wizard/proposal/generate/route.ts`: the
 * canonical engine (`@caia/interviewer`) is imported by the live path
 * but the wizard ships with an in-memory stub so the page renders
 * end-to-end without a Claude subscription wired through the dashboard
 * runtime (which is gated behind `WIZARD_INTERVIEW_LIVE=1`).
 *
 * The stub is INTENTIONALLY small: 8 questions spanning 8 pillars, each
 * with a single follow-up. The real engine asks 30-50 turns across the
 * full 16-pillar / 364-question playbook. The stub is what the wizard
 * page hits in default mode so the surface is reachable + testable.
 *
 * The same pillar coverage shape is emitted by both the stub and the
 * live path so the client component never needs to branch on source.
 */

import { PILLAR_IDS } from '@caia/interviewer';

export type PillarId = (typeof PILLAR_IDS)[number];

export interface ScriptedQuestion {
  /** Stable id (`Q-<n>`). */
  readonly id: string;
  /** Pillar this question hits — drives the radar increment. */
  readonly pillar: PillarId;
  /** The human-facing question text. */
  readonly text: string;
  /** Rationale shown under the question. */
  readonly rationale: string;
}

export interface PillarCoverageEntry {
  /** 0..100 — confidence we've heard enough on this pillar. */
  readonly score: number;
  /** Number of turns that touched this pillar. */
  readonly hits: number;
  /** Last turn that touched this pillar. */
  readonly lastTouchedTurn: number;
}

export type PillarCoverageMap = Readonly<Record<PillarId, PillarCoverageEntry>>;

export const SCRIPTED_QUESTIONS: ReadonlyArray<ScriptedQuestion> = [
  {
    id: 'Q-1',
    pillar: 'B1',
    text: 'In one sentence, what is the product and who is it for?',
    rationale:
      'Anchors the rest of the interview to a concrete product + audience pair.',
  },
  {
    id: 'Q-2',
    pillar: 'B2',
    text: 'What is the single most painful problem this product solves, and how does the customer experience it today?',
    rationale:
      'Establishes the wedge — the specific pain that justifies a switch.',
  },
  {
    id: 'Q-3',
    pillar: 'B3',
    text: 'Who are the closest 2-3 existing alternatives, and where do they fall short?',
    rationale: 'Forces an honest competitive read.',
  },
  {
    id: 'Q-4',
    pillar: 'B4',
    text: 'What is the smallest version of the product you would ship to learn whether the wedge is real?',
    rationale: 'Pins down the MVP slice.',
  },
  {
    id: 'Q-5',
    pillar: 'B5',
    text: 'How will the first 10 paying customers find you?',
    rationale: 'Surfaces a concrete GTM lever — not abstractions.',
  },
  {
    id: 'Q-6',
    pillar: 'B6',
    text: 'What does success look like at 12 months — revenue, customer count, or product milestone?',
    rationale: 'Forces a measurable goal.',
  },
  {
    id: 'Q-7',
    pillar: 'B7',
    text: 'What is your unfair advantage — distribution, expertise, network, or something else?',
    rationale: 'Decides whether the founder is the right person to do this.',
  },
  {
    id: 'Q-8',
    pillar: 'B8',
    text: 'What is the most likely reason this product fails, and how would you spot it early?',
    rationale: 'Surfaces a real risk and an early-warning signal.',
  },
];

/**
 * Threshold (per the engine's spec §5) is aggregate ≥ 82. The stub uses
 * a deterministic per-answer increment so that after the 8 scripted
 * turns the aggregate naturally clears 82 — the page can then advance.
 */
export const COMPLETE_THRESHOLD = 82;

/**
 * Build an empty pillar-coverage map. Used by the route on a brand-new
 * thread before the first answer.
 */
export function emptyPillarCoverage(): PillarCoverageMap {
  const entries = PILLAR_IDS.map((pid) => [
    pid,
    { score: 0, hits: 0, lastTouchedTurn: 0 } satisfies PillarCoverageEntry,
  ] as const);
  return Object.fromEntries(entries) as Record<PillarId, PillarCoverageEntry>;
}

/**
 * Apply a single answer to the coverage map. Deterministic: each touch
 * on a pillar bumps the score by 22 (so 5 touches saturate at 100), and
 * records the turn. We clamp at 100.
 */
export function applyAnswer(
  prev: PillarCoverageMap,
  pillar: PillarId,
  turn: number,
  /** Length of the answer in characters — used as a tiny bonus so the
   *  score isn't just "count of touches". */
  answerLength: number,
): PillarCoverageMap {
  const existing = prev[pillar];
  const lengthBonus = Math.min(8, Math.floor(answerLength / 40));
  const nextScore = Math.min(100, existing.score + 22 + lengthBonus);
  const next = {
    ...prev,
    [pillar]: {
      score: nextScore,
      hits: existing.hits + 1,
      lastTouchedTurn: turn,
    },
  };
  return next;
}

/**
 * Aggregate score across all 16 pillars. Mean of per-pillar scores.
 * Matches the engine's `aggregateScore` semantic (different math, same
 * 0..100 range) so the client doesn't have to branch.
 */
export function aggregateScore(coverage: PillarCoverageMap): number {
  const values = Object.values(coverage);
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v.score, 0);
  return Math.round(sum / values.length);
}

/** Resolve a question by index (1-based turn number). */
export function questionForTurn(turn: number): ScriptedQuestion | null {
  if (turn < 1) return null;
  return SCRIPTED_QUESTIONS[turn - 1] ?? null;
}

/** Total scripted turns. */
export function totalScriptedTurns(): number {
  return SCRIPTED_QUESTIONS.length;
}
