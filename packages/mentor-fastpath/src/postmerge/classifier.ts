/**
 * Postmerge classifier — maps a structured PostMergeInput to one of the
 * 18 failure-mode categories from `mentor_agent_directive.md`.
 *
 * Routing principles (stable across PRs):
 *
 *   1. **PR merged + CI red on the merge commit (regression-after-merge)**
 *      → primary='PrematureCompletion' (the PR claimed done but tests
 *      didn't catch a real defect). secondary=['Incompleteness'].
 *      severity high if postMergeAgeSec ≤ 600 (under 10 minutes — clear
 *      DoD slip). lower if older (more likely upstream / flake).
 *
 *   2. **Evidence-Gate failed (pre-merge)** → primary='Incompleteness'
 *      (DoD's required-check gate caught it before merge — this is the
 *      gate working *correctly*; the lesson is that the agent submitted
 *      without locally running the failed job class first).
 *      secondary=['LackingInformation'] when the failed jobs include
 *      lint/typecheck (cheap-to-run-locally signals). severity medium.
 *
 *   3. **Failed-job names imply specific subcategories**:
 *      - 'lint' or 'typecheck'   → secondary tag 'LackingInformation'
 *      - 'security' or 'migration-linter' → secondary tag
 *        'SecurityRegression' OR 'GitHygieneFailure'
 *      - 'integration' or 'e2e' or 'live'  → keep primary, severity high
 *      - unknown job names       → primary stays, no extra secondary
 *
 *   4. **Post-merge bug report** → primary='PrematureCompletion'.
 *      severity high. Description may bump secondary tags (e.g. if it
 *      mentions 'security' or 'credential leak', add SecurityRegression).
 *
 *   5. **PRMerged-only signal (no CI failure observed)** → not
 *      classified as a failure. Returns primary='Unclassified' with
 *      confidence=0. The consumer is expected to skip it (no proposal
 *      generated).
 *
 * Pure function: deterministic, no side effects.
 */

import type {
  ClassificationResult,
  FailureMode,
  Generalizability,
  PostMergeInput,
  Severity
} from './types.js';

/** Job-name fragments → secondary FailureMode tags. */
const JOB_TAGS: ReadonlyArray<{ pattern: RegExp; tag: FailureMode }> = [
  { pattern: /\b(lint|typecheck|prettier|format)\b/i, tag: 'LackingInformation' },
  { pattern: /\b(migration[- ]?linter|migration[- ]?numbering|graph[- ]?divergence)\b/i, tag: 'GitHygieneFailure' },
  { pattern: /\b(security|secret|credential|auth)\b/i, tag: 'SecurityRegression' },
  { pattern: /\b(e2e|integration|live|playwright)\b/i, tag: 'Incompleteness' },
  { pattern: /\b(perf|performance|benchmark)\b/i, tag: 'Incompleteness' }
];

/**
 * Mark a description string as containing a sub-category cue.
 * Returns at most ONE secondary tag (highest-priority match wins).
 */
function descriptionTag(description: string | undefined): FailureMode | null {
  if (!description) return null;
  const lc = description.toLowerCase();
  if (/\b(security|credential|secret|leak|exposed)\b/.test(lc)) {
    return 'SecurityRegression';
  }
  if (/\b(flaky|flake|intermittent)\b/.test(lc)) {
    return 'CIFlakeAsRealFailure';
  }
  if (/\b(memory|directive|feedback file|directive ignored)\b/.test(lc)) {
    return 'MemoryDrift';
  }
  if (/\b(scope|brief|wrong scope)\b/.test(lc)) {
    return 'ScopeMismatch';
  }
  return null;
}

/**
 * Compute the final secondary tag list — dedupe, keep order stable.
 *
 * Order: failed-job tags first (sorted by appearance order in the input
 * array), then description tag if any.
 */
function buildSecondary(
  failedJobs: ReadonlyArray<string>,
  description: string | undefined,
  primary: FailureMode
): FailureMode[] {
  const out: FailureMode[] = [];
  const seen = new Set<FailureMode>([primary]);
  for (const job of failedJobs) {
    for (const { pattern, tag } of JOB_TAGS) {
      if (pattern.test(job) && !seen.has(tag)) {
        out.push(tag);
        seen.add(tag);
      }
    }
  }
  const descTag = descriptionTag(description);
  if (descTag !== null && !seen.has(descTag)) {
    out.push(descTag);
    seen.add(descTag);
  }
  return out;
}

/** Severity heuristic for the regression-after-merge signal. */
function regressionSeverity(input: PostMergeInput): Severity {
  if (typeof input.postMergeAgeSec === 'number') {
    if (input.postMergeAgeSec <= 600) return 'high'; // ≤10 min — clear DoD slip
    if (input.postMergeAgeSec <= 86_400) return 'medium'; // ≤24 h — likely real
    return 'low'; // >24 h — could be churn / flake
  }
  // Unknown age → conservative high (we'd rather over-flag than miss).
  return 'high';
}

/**
 * Classify a single postmerge event payload.
 *
 * Always returns a ClassificationResult. Never throws.
 *
 * The 'pr-merged-only' signal returns Unclassified (confidence=0) so
 * the consumer skips proposal generation — PRMerged with no failure is
 * informational, not a failure.
 */
export function classifyPostMerge(input: PostMergeInput): ClassificationResult {
  // Defensive: failedJobs may be undefined when callers construct the
  // input from partial event data. Treat missing as empty.
  const failedJobs = Array.isArray(input.failedJobs) ? input.failedJobs : [];

  if (input.signal === 'pr-merged-only') {
    return {
      primary: 'Unclassified',
      secondary: [],
      severity: 'low',
      generalizability: 'unknown',
      matchedBy: 'pr-merged-only-no-failure',
      confidence: 0.0
    };
  }

  let primary: FailureMode;
  let severity: Severity;
  let generalizability: Generalizability;
  let matchedBy: string;

  switch (input.signal) {
    case 'regression-after-merge': {
      primary = 'PrematureCompletion';
      severity = regressionSeverity(input);
      generalizability =
        typeof input.postMergeAgeSec === 'number' && input.postMergeAgeSec <= 600
          ? 'systemic'
          : 'unknown';
      matchedBy = 'regression-after-merge';
      break;
    }
    case 'evidence-gate-failed': {
      primary = 'Incompleteness';
      severity = 'medium';
      generalizability = 'systemic';
      matchedBy = 'evidence-gate-failed';
      break;
    }
    case 'post-merge-bug-report': {
      primary = 'PrematureCompletion';
      severity = 'high';
      generalizability = 'unknown';
      matchedBy = 'post-merge-bug-report';
      break;
    }
    default: {
      // Defensive: unknown signal → Unclassified, low confidence.
      return {
        primary: 'Unclassified',
        secondary: [],
        severity: 'medium',
        generalizability: 'unknown',
        matchedBy: 'unknown-signal',
        confidence: 0.0
      };
    }
  }

  const secondary = buildSecondary(failedJobs, input.description, primary);

  // Confidence calibration:
  //   - regression-after-merge with named failed jobs: 1.0 (clear-cut)
  //   - regression-after-merge with no failed jobs: 0.7 (something
  //     failed but we don't know what)
  //   - evidence-gate-failed: 1.0 (gate is the source of truth)
  //   - post-merge-bug-report: 0.85 (operator-provided; high but not
  //     from automation)
  let confidence: number;
  if (input.signal === 'evidence-gate-failed') {
    confidence = 1.0;
  } else if (input.signal === 'regression-after-merge') {
    confidence = failedJobs.length > 0 ? 1.0 : 0.7;
  } else {
    confidence = 0.85;
  }

  return {
    primary,
    secondary,
    severity,
    generalizability,
    matchedBy,
    confidence
  };
}

/**
 * Test/debug helper — returns the count of job-tag rules. Mirror of the
 * Phase-1 classifier's `_ruleCount` for parity.
 */
export function _jobTagCount(): number {
  return JOB_TAGS.length;
}
