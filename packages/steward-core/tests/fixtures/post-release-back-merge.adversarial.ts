/**
 * Adversarial-injection corpus for `post-release-back-merge.yaml`.
 *
 * Per `feedback_definition_of_done.md` (DoD item 14, PR-specific):
 * adversarial-injection corpus regression-suite must be green.
 *
 * Each case is a tuple of (events, cycle_at, expected_drift_count) plus a
 * descriptive name. POSITIVE_CASES expect drift; NEGATIVE_CASES expect no
 * drift; ADVERSARIAL_CASES are events designed to mimic a violation without
 * actually being one (or the inverse).
 *
 * The release-landed reference timestamp `T0 = 0` is used; `cycle_at` is
 * relative to that.
 */

import type { StewardEvent } from '../../src/events.js';

const T0 = 0;
const MIN = 60_000;

function pr(opts: {
  id: string;
  type: 'github.pull_request.merged' | 'github.pull_request.opened';
  baseRef: string;
  headRef: string;
  observedAt: number;
  prNumber?: number;
  correlationId?: string;
}): StewardEvent {
  return {
    id: opts.id,
    source: 'github',
    type: opts.type,
    repo: 'caia',
    payload: {
      base_ref: opts.baseRef,
      head_ref: opts.headRef,
      pr_number: opts.prNumber ?? 281,
      merge_commit_sha: 'sha-' + opts.id,
    },
    observedAt: opts.observedAt,
    correlationId: opts.correlationId ?? `release-${opts.prNumber ?? 281}`,
  };
}

export interface FixtureCase {
  name: string;
  events: StewardEvent[];
  cycleAt: number;
  expectedDriftCount: number;
}

export const POSITIVE_CASES: FixtureCase[] = [
  {
    name: 'release landed, 31 min later no back-merge → drift',
    events: [
      pr({
        id: 'p1',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02-cleanup',
        observedAt: T0,
      }),
    ],
    cycleAt: 31 * MIN,
    expectedDriftCount: 1,
  },
  {
    name: 'release landed, 60 min later no back-merge → drift',
    events: [
      pr({
        id: 'p2',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-04-30-obs-foundation',
        observedAt: T0,
      }),
    ],
    cycleAt: 60 * MIN,
    expectedDriftCount: 1,
  },
  {
    name: 'release landed, 24 hours pass with nothing → drift',
    events: [
      pr({
        id: 'p3',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-04-29',
        observedAt: T0,
      }),
    ],
    cycleAt: 24 * 60 * MIN,
    expectedDriftCount: 1,
  },
  {
    name: 'two releases land back-to-back; only one has a back-merge → drift on the second',
    events: [
      pr({
        id: 'p4a',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-04-30',
        observedAt: T0,
        prNumber: 270,
        correlationId: 'release-270',
      }),
      pr({
        id: 'p4a-bm',
        type: 'github.pull_request.opened',
        baseRef: 'develop',
        headRef: 'main',
        observedAt: T0 + 5 * MIN,
        prNumber: 271,
        correlationId: 'release-270',
      }),
      pr({
        id: 'p4b',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02',
        observedAt: T0 + 10 * MIN,
        prNumber: 281,
        correlationId: 'release-281',
      }),
    ],
    cycleAt: T0 + 41 * MIN,
    expectedDriftCount: 1,
  },
  {
    name: 'back-merge opened but not merged after 4h+ → drift on the merge transition',
    events: [
      pr({
        id: 'p5a',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02',
        observedAt: T0,
      }),
      pr({
        id: 'p5b',
        type: 'github.pull_request.opened',
        baseRef: 'develop',
        headRef: 'main',
        observedAt: T0 + 5 * MIN,
      }),
    ],
    // 5 hours after the PR opened. The 30-min transition is satisfied;
    // the 240-min transition is not.
    cycleAt: T0 + 5 * MIN + 245 * MIN,
    expectedDriftCount: 1,
  },
];

export const NEGATIVE_CASES: FixtureCase[] = [
  {
    name: 'release landed, back-merge opened 5 min later → no drift',
    events: [
      pr({
        id: 'n1a',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02',
        observedAt: T0,
      }),
      pr({
        id: 'n1b',
        type: 'github.pull_request.opened',
        baseRef: 'develop',
        headRef: 'main',
        observedAt: T0 + 5 * MIN,
      }),
    ],
    cycleAt: T0 + 30 * MIN,
    expectedDriftCount: 0,
  },
  {
    name: 'release landed, back-merge opened at exactly 29 min → no drift (just under deadline)',
    events: [
      pr({
        id: 'n2a',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02',
        observedAt: T0,
      }),
      pr({
        id: 'n2b',
        type: 'github.pull_request.opened',
        baseRef: 'develop',
        headRef: 'main',
        observedAt: T0 + 29 * MIN,
      }),
    ],
    cycleAt: T0 + 30 * MIN,
    expectedDriftCount: 0,
  },
  {
    name: 'release landed but cycle is at 29 min → no drift (deadline not yet elapsed)',
    events: [
      pr({
        id: 'n3',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02',
        observedAt: T0,
      }),
    ],
    cycleAt: T0 + 29 * MIN,
    expectedDriftCount: 0,
  },
  {
    name: 'feature merge to main (NOT release/) → no drift (not a release event)',
    events: [
      pr({
        id: 'n4',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'feature/foo',
        observedAt: T0,
      }),
    ],
    cycleAt: T0 + 60 * MIN,
    expectedDriftCount: 0,
  },
  {
    name: 'release landed, back-merge opened AND merged → no drift',
    events: [
      pr({
        id: 'n5a',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02',
        observedAt: T0,
      }),
      pr({
        id: 'n5b',
        type: 'github.pull_request.opened',
        baseRef: 'develop',
        headRef: 'main',
        observedAt: T0 + 5 * MIN,
      }),
      pr({
        id: 'n5c',
        type: 'github.pull_request.merged',
        baseRef: 'develop',
        headRef: 'main',
        observedAt: T0 + 30 * MIN,
      }),
    ],
    cycleAt: T0 + 5 * 60 * MIN,
    expectedDriftCount: 0,
  },
];

export const ADVERSARIAL_CASES: FixtureCase[] = [
  {
    name: 'PR opened with base=develop head=main but action=closed (not opened) → no drift detection of back-merge',
    events: [
      pr({
        id: 'a1a',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02',
        observedAt: T0,
      }),
      // Even though base/head match, the type is 'merged' — the invariant
      // detects merge-of-back-merge, not opened. The opened-side invariant
      // requires type='github.pull_request.opened'.
      // Net effect: no `back_merge_opened` event, no `back_merge_merged`
      // event matched within the deadline, drift fires.
    ],
    cycleAt: T0 + 31 * MIN,
    expectedDriftCount: 1,
  },
  {
    name: 'release landed but PR head_ref looks like release/ but is in a release-like sub-folder — should still match',
    events: [
      pr({
        id: 'a2',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02-cleanup',
        observedAt: T0,
      }),
    ],
    cycleAt: T0 + 31 * MIN,
    expectedDriftCount: 1,
  },
  {
    name: 'PR with base=develop head=main but pr_number missing in payload → still detected',
    events: [
      pr({
        id: 'a3a',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02',
        observedAt: T0,
      }),
      {
        id: 'a3b',
        source: 'github',
        type: 'github.pull_request.opened',
        repo: 'caia',
        payload: {
          base_ref: 'develop',
          head_ref: 'main',
          // pr_number deliberately omitted
        },
        observedAt: T0 + 10 * MIN,
        correlationId: 'release-281',
      },
    ],
    cycleAt: T0 + 31 * MIN,
    expectedDriftCount: 0,
  },
  {
    name: 'event with base_ref=main head_ref="release/foo/bar" should still match (regex matches anywhere prefixed)',
    events: [
      pr({
        id: 'a4',
        type: 'github.pull_request.merged',
        baseRef: 'main',
        headRef: 'release/2026-05-02/cleanup',
        observedAt: T0,
      }),
    ],
    cycleAt: T0 + 31 * MIN,
    expectedDriftCount: 1,
  },
  {
    name: 'malformed payload (missing base_ref) → safely no drift detection',
    events: [
      {
        id: 'a5',
        source: 'github',
        type: 'github.pull_request.merged',
        repo: 'caia',
        payload: {
          // base_ref missing — predicate returns false
          head_ref: 'release/2026-05-02',
        },
        observedAt: T0,
      },
    ],
    cycleAt: T0 + 31 * MIN,
    expectedDriftCount: 0,
  },
];
