/**
 * Graph-divergence analyzer (failure mode #2).
 *
 * Checks whether `git merge-base origin/develop origin/main` is older
 * than a configurable threshold (default 7 days). When divergence
 * accumulates, release/* PRs hit `mergeStateStatus: DIRTY` and need a
 * graph-resync PR before they can land — exactly the pain pattern
 * documented in `back-merge-2026-05-03-decisions.md` and
 * `release-blocker-2026-05-02.md`.
 *
 * Severity scaling per architecture doc §3.2:
 *   - On a release/* PR: drift > threshold → block (must resync first).
 *   - On any other PR: drift > threshold → warn (so it's surfaced before
 *     it becomes a release-day fire).
 *
 * Inputs are passed in (rather than shelling out from this module) so
 * the analyzer is unit-testable. The CLI shim does the actual git
 * invocation.
 */

import type { Finding } from './types.js';

export interface GraphDivergenceInput {
  /** Unix timestamp (seconds) of merge-base commit between develop and main. */
  mergeBaseTimestamp: number;
  /** Unix timestamp (seconds) "now" — pass Date.now()/1000 in production. */
  nowTimestamp: number;
  /** Max acceptable age in days. Default 7 (architecture doc §3.2). */
  maxAgeDays?: number;
  /** Branch ref of the PR being checked. `release/*` triggers block-severity. */
  prHeadRef?: string;
  /** Whether a recent back-merge PR already exists (suppresses the finding). */
  backMergePrPresent?: boolean;
}

export function checkGraphDivergence(input: GraphDivergenceInput): Finding[] {
  const maxAgeDays = input.maxAgeDays ?? 7;
  const ageSeconds = input.nowTimestamp - input.mergeBaseTimestamp;
  const ageDays = ageSeconds / 86400;

  if (ageDays <= maxAgeDays) return [];
  if (input.backMergePrPresent) return [];

  const isReleasePr = (input.prHeadRef ?? '').startsWith('release/');
  const severity = isReleasePr ? 'block' : 'medium';

  return [
    {
      analyzer: 'graph-divergence',
      ruleId: 'develop-main-merge-base-stale',
      path: '<repo>',
      severity,
      message: `develop ↔ main merge-base is ${ageDays.toFixed(1)} days old (limit ${maxAgeDays}). ${isReleasePr ? 'release/* PR cannot merge cleanly without a back-merge PR landing first; see back-merge-2026-05-03-decisions.md for the canonical recipe.' : 'A release/* PR opened today will likely hit mergeStateStatus: DIRTY. Open a `chore/back-merge-main-into-develop-YYYY-MM-DD` PR before the next release.'}`,
      remediation:
        'Run `pnpm flow back-merge` (or manually: `git checkout -b chore/back-merge-main-into-develop-$(date +%Y-%m-%d) origin/develop && git merge --no-ff origin/main && gh pr create --base develop --head chore/back-merge-main-into-develop-$(date +%Y-%m-%d)`). See `feedback_git_flow_enforced.md` § "MANDATORY POST-RELEASE STEP".',
      context: {
        mergeBaseTimestamp: input.mergeBaseTimestamp,
        ageDays,
        maxAgeDays,
        prHeadRef: input.prHeadRef ?? null,
        isReleasePr,
      },
    },
  ];
}
