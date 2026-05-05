/**
 * Unit tests for the Phase-2 postmerge classifier.
 *
 * Coverage matrix:
 *   - Each `signal` value (4): pr-merged-only, evidence-gate-failed,
 *     regression-after-merge, post-merge-bug-report.
 *   - Severity heuristic by postMergeAgeSec (≤600s, ≤86400s, >86400s).
 *   - Job-name → secondary-tag mapping (lint, migration-linter,
 *     security, integration, perf).
 *   - Description → secondary-tag mapping (security, flake, memory).
 *   - Confidence calibration per signal.
 *   - Defensive: missing failedJobs array, unknown signal, empty
 *     description.
 */

import { describe, expect, it } from 'vitest';

import {
  _postmergeJobTagCount,
  classifyPostMerge
} from '../../src/postmerge/index.js';
import type { PostMergeInput } from '../../src/postmerge/index.js';

function base(overrides: Partial<PostMergeInput> = {}): PostMergeInput {
  return {
    prNumber: 100,
    sha: 'deadbeef',
    branch: 'develop',
    failedJobs: [],
    signal: 'pr-merged-only',
    ...overrides
  };
}

describe('classifyPostMerge — pr-merged-only signal', () => {
  it('returns Unclassified with confidence 0', () => {
    const r = classifyPostMerge(base({ signal: 'pr-merged-only' }));
    expect(r.primary).toBe('Unclassified');
    expect(r.confidence).toBe(0);
    expect(r.matchedBy).toBe('pr-merged-only-no-failure');
  });

  it('does not attach secondary tags', () => {
    const r = classifyPostMerge(
      base({ signal: 'pr-merged-only', failedJobs: ['lint'] })
    );
    expect(r.secondary).toEqual([]);
  });
});

describe('classifyPostMerge — evidence-gate-failed signal', () => {
  it('classifies as Incompleteness with full confidence', () => {
    const r = classifyPostMerge(
      base({ signal: 'evidence-gate-failed', failedJobs: ['typecheck'] })
    );
    expect(r.primary).toBe('Incompleteness');
    expect(r.confidence).toBe(1.0);
    expect(r.severity).toBe('medium');
    expect(r.generalizability).toBe('systemic');
    expect(r.matchedBy).toBe('evidence-gate-failed');
  });

  it('attaches LackingInformation tag for cheap-local jobs (lint/typecheck)', () => {
    const r = classifyPostMerge(
      base({
        signal: 'evidence-gate-failed',
        failedJobs: ['lint', 'typecheck']
      })
    );
    expect(r.secondary).toContain('LackingInformation');
  });

  it('attaches GitHygieneFailure tag for migration-linter jobs', () => {
    const r = classifyPostMerge(
      base({ signal: 'evidence-gate-failed', failedJobs: ['migration-linter'] })
    );
    expect(r.secondary).toContain('GitHygieneFailure');
  });
});

describe('classifyPostMerge — regression-after-merge signal', () => {
  it('classifies as PrematureCompletion', () => {
    const r = classifyPostMerge(
      base({
        signal: 'regression-after-merge',
        failedJobs: ['integration-tests']
      })
    );
    expect(r.primary).toBe('PrematureCompletion');
    expect(r.confidence).toBe(1.0);
  });

  it('severity=high when postMergeAgeSec ≤ 600 (≤10 min)', () => {
    const r = classifyPostMerge(
      base({
        signal: 'regression-after-merge',
        failedJobs: ['unit-tests'],
        postMergeAgeSec: 300
      })
    );
    expect(r.severity).toBe('high');
    expect(r.generalizability).toBe('systemic');
  });

  it('severity=medium when 600 < postMergeAgeSec ≤ 86400', () => {
    const r = classifyPostMerge(
      base({
        signal: 'regression-after-merge',
        failedJobs: ['e2e'],
        postMergeAgeSec: 3600
      })
    );
    expect(r.severity).toBe('medium');
    expect(r.generalizability).toBe('unknown');
  });

  it('severity=low when postMergeAgeSec > 86400 (over 24h)', () => {
    const r = classifyPostMerge(
      base({
        signal: 'regression-after-merge',
        failedJobs: ['e2e'],
        postMergeAgeSec: 200_000
      })
    );
    expect(r.severity).toBe('low');
  });

  it('severity=high when postMergeAgeSec is missing (conservative default)', () => {
    const r = classifyPostMerge(
      base({ signal: 'regression-after-merge', failedJobs: ['unit'] })
    );
    expect(r.severity).toBe('high');
  });

  it('confidence=0.7 when failedJobs is empty (regression detected but no detail)', () => {
    const r = classifyPostMerge(
      base({ signal: 'regression-after-merge', failedJobs: [] })
    );
    expect(r.confidence).toBeCloseTo(0.7);
  });
});

describe('classifyPostMerge — post-merge-bug-report signal', () => {
  it('classifies as PrematureCompletion (high severity)', () => {
    const r = classifyPostMerge(
      base({
        signal: 'post-merge-bug-report',
        description: 'auth bypass found 2h after merge'
      })
    );
    expect(r.primary).toBe('PrematureCompletion');
    expect(r.severity).toBe('high');
    expect(r.confidence).toBeCloseTo(0.85);
  });

  it('attaches SecurityRegression secondary tag when description mentions credentials', () => {
    const r = classifyPostMerge(
      base({
        signal: 'post-merge-bug-report',
        description: 'credential leaked in env template'
      })
    );
    expect(r.secondary).toContain('SecurityRegression');
  });

  it('attaches CIFlakeAsRealFailure when description mentions flake', () => {
    const r = classifyPostMerge(
      base({
        signal: 'post-merge-bug-report',
        description: 'flaky test masquerading as a real bug'
      })
    );
    expect(r.secondary).toContain('CIFlakeAsRealFailure');
  });

  it('attaches MemoryDrift when description mentions directive/memory', () => {
    const r = classifyPostMerge(
      base({
        signal: 'post-merge-bug-report',
        description: 'the relevant directive was ignored'
      })
    );
    expect(r.secondary).toContain('MemoryDrift');
  });

  it('attaches ScopeMismatch when description mentions scope drift', () => {
    const r = classifyPostMerge(
      base({
        signal: 'post-merge-bug-report',
        description: 'this PR introduced scope drift in the brief'
      })
    );
    expect(r.secondary).toContain('ScopeMismatch');
  });
});

describe('classifyPostMerge — secondary tags from failed jobs', () => {
  it('integration / e2e jobs add Incompleteness tag', () => {
    const r = classifyPostMerge(
      base({
        signal: 'regression-after-merge',
        failedJobs: ['e2e-playwright']
      })
    );
    expect(r.secondary).toContain('Incompleteness');
  });

  it('security / auth jobs add SecurityRegression tag', () => {
    const r = classifyPostMerge(
      base({
        signal: 'regression-after-merge',
        failedJobs: ['security-scan']
      })
    );
    expect(r.secondary).toContain('SecurityRegression');
  });

  it('does not duplicate the primary as a secondary tag', () => {
    const r = classifyPostMerge(
      base({
        signal: 'evidence-gate-failed',
        failedJobs: ['integration-tests']
      })
    );
    // Primary is Incompleteness; secondary tag rule for integration is also
    // Incompleteness — must dedupe.
    expect(r.primary).toBe('Incompleteness');
    expect(r.secondary).not.toContain('Incompleteness');
  });

  it('preserves first-seen order for multiple secondary tags', () => {
    const r = classifyPostMerge(
      base({
        signal: 'regression-after-merge',
        failedJobs: ['lint', 'security-scan', 'e2e']
      })
    );
    // lint → LackingInformation (first), security → SecurityRegression,
    // e2e → Incompleteness.
    expect(r.secondary[0]).toBe('LackingInformation');
    expect(r.secondary).toContain('SecurityRegression');
    expect(r.secondary).toContain('Incompleteness');
  });
});

describe('classifyPostMerge — defensive', () => {
  it('handles missing failedJobs (treats as empty)', () => {
    const r = classifyPostMerge({
      ...base({ signal: 'regression-after-merge' }),
      failedJobs: undefined as unknown as string[]
    });
    expect(r.primary).toBe('PrematureCompletion');
    expect(r.secondary).toEqual([]);
  });

  it('returns Unclassified for unknown signal value', () => {
    const r = classifyPostMerge({
      ...base(),
      signal: 'no-such-signal' as PostMergeInput['signal']
    });
    expect(r.primary).toBe('Unclassified');
    expect(r.confidence).toBe(0);
    expect(r.matchedBy).toBe('unknown-signal');
  });

  it('handles empty description without crashing', () => {
    const r = classifyPostMerge(
      base({ signal: 'post-merge-bug-report', description: '' })
    );
    expect(r.primary).toBe('PrematureCompletion');
  });

  it('handles missing description gracefully', () => {
    const r = classifyPostMerge(
      base({ signal: 'post-merge-bug-report' })
    );
    expect(r.primary).toBe('PrematureCompletion');
  });
});

describe('_postmergeJobTagCount regression guard', () => {
  it('has at least 5 job-tag rules', () => {
    expect(_postmergeJobTagCount()).toBeGreaterThanOrEqual(5);
  });
});
