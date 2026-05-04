import { describe, it, expect } from 'vitest';
import {
  checkStashCount,
  checkWorktreeCount,
  checkOrphanBranches,
  preflightChecks,
} from '../src/local-state.js';

describe('checkStashCount (failure mode #4)', () => {
  it('returns no findings when stash list is empty', () => {
    expect(checkStashCount({ stashEntries: [] })).toEqual([]);
  });

  it('returns medium severity for 1-5 stashes', () => {
    const findings = checkStashCount({
      stashEntries: ['stash@{0}: WIP', 'stash@{1}: WIP', 'stash@{2}: WIP'],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].context?.count).toBe(3);
    expect(findings[0].ruleId).toBe('stash-accumulation');
  });

  it('returns high severity above default 5-stash threshold', () => {
    const stashEntries = Array.from(
      { length: 6 },
      (_, i) => `stash@{${i}}: WIP`,
    );
    const findings = checkStashCount({ stashEntries });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
  });

  it('honours a custom highThreshold', () => {
    const stashEntries = Array.from({ length: 3 }, () => 'stash@{}');
    expect(
      checkStashCount({ stashEntries, highThreshold: 2 })[0].severity,
    ).toBe('high');
  });

  it('embeds remediation hint pointing at backup/* preservation', () => {
    const findings = checkStashCount({ stashEntries: ['stash@{0}'] });
    expect(findings[0].remediation).toContain('git stash branch backup/');
  });
});

describe('checkWorktreeCount (failure mode #6)', () => {
  it('returns no findings at or below warn threshold', () => {
    // 8 secondary + 1 primary = 9 entries; count = 8; equals warn = 8 → no finding
    const worktrees = Array.from({ length: 9 }, (_, i) => ({
      path: `/tmp/wt${i}`,
      branch: `feature/${i}`,
    }));
    expect(checkWorktreeCount({ worktrees })).toEqual([]);
  });

  it('returns medium severity between warn and block', () => {
    // 10 secondary + 1 primary; count = 10
    const worktrees = Array.from({ length: 11 }, (_, i) => ({
      path: `/tmp/wt${i}`,
      branch: `feature/${i}`,
    }));
    const findings = checkWorktreeCount({ worktrees });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].context?.count).toBe(10);
  });

  it('returns high severity above block threshold', () => {
    // 13 secondary + 1 primary; count = 13 > block 12
    const worktrees = Array.from({ length: 14 }, (_, i) => ({
      path: `/tmp/wt${i}`,
      branch: `feature/${i}`,
    }));
    const findings = checkWorktreeCount({ worktrees });
    expect(findings[0].severity).toBe('high');
    expect(findings[0].message).toContain('block threshold');
  });

  it('handles zero worktrees gracefully', () => {
    expect(checkWorktreeCount({ worktrees: [] })).toEqual([]);
  });

  it('honours custom thresholds', () => {
    // 4 secondary + 1 primary; count=4 > custom warn=3
    const worktrees = Array.from({ length: 5 }, (_, i) => ({
      path: `/tmp/wt${i}`,
      branch: `feature/${i}`,
    }));
    const findings = checkWorktreeCount({
      worktrees,
      warnThreshold: 3,
      blockThreshold: 5,
    });
    expect(findings[0].severity).toBe('medium');
  });
});

describe('checkOrphanBranches (failure mode #5)', () => {
  const NOW = 1779840000; // 2026-05-04 epoch sec
  const HOURS = 3600;
  const DAYS = 86400;

  it('returns no findings when branches list is empty', () => {
    expect(checkOrphanBranches({ branches: [], nowEpoch: NOW })).toEqual([]);
  });

  it('ignores main, develop, backup/*, release/*, dependabot/*, archive/*', () => {
    const branches = [
      { branch: 'main', committerTimeUnix: NOW - 30 * DAYS, hasOpenPr: false },
      {
        branch: 'develop',
        committerTimeUnix: NOW - 30 * DAYS,
        hasOpenPr: false,
      },
      {
        branch: 'backup/2026-04-30/foo',
        committerTimeUnix: NOW - 90 * DAYS,
        hasOpenPr: false,
      },
      {
        branch: 'release/2026-05-02-cleanup',
        committerTimeUnix: NOW - 30 * DAYS,
        hasOpenPr: false,
      },
      {
        branch: 'dependabot/npm/foo',
        committerTimeUnix: NOW - 14 * DAYS,
        hasOpenPr: false,
      },
      {
        branch: 'archive/2026-05-04/x',
        committerTimeUnix: NOW - 90 * DAYS,
        hasOpenPr: false,
      },
    ];
    expect(
      checkOrphanBranches({ branches, nowEpoch: NOW }),
    ).toEqual([]);
  });

  it('ignores branches younger than 7 days', () => {
    const branches = [
      {
        branch: 'feat/recent',
        committerTimeUnix: NOW - 3 * DAYS,
        hasOpenPr: false,
      },
    ];
    expect(checkOrphanBranches({ branches, nowEpoch: NOW })).toEqual([]);
  });

  it('ignores branches with open PR even when > 7 days old', () => {
    const branches = [
      {
        branch: 'feat/in-review',
        committerTimeUnix: NOW - 14 * DAYS,
        hasOpenPr: true,
      },
    ];
    expect(checkOrphanBranches({ branches, nowEpoch: NOW })).toEqual([]);
  });

  it('flags an old branch without open PR with medium severity', () => {
    const branches = [
      {
        branch: 'feat/old-no-pr',
        committerTimeUnix: NOW - 10 * DAYS,
        hasOpenPr: false,
      },
    ];
    const findings = checkOrphanBranches({ branches, nowEpoch: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].context?.count).toBe(1);
  });

  it('escalates to high above cumulative threshold', () => {
    const branches = Array.from({ length: 51 }, (_, i) => ({
      branch: `feat/orphan-${i}`,
      committerTimeUnix: NOW - 15 * DAYS,
      hasOpenPr: false,
    }));
    const findings = checkOrphanBranches({ branches, nowEpoch: NOW });
    expect(findings[0].severity).toBe('high');
    expect(findings[0].context?.count).toBe(51);
  });

  it('honours custom ageDaysThreshold', () => {
    const branches = [
      {
        branch: 'feat/maybe-orphan',
        committerTimeUnix: NOW - 5 * DAYS,
        hasOpenPr: false,
      },
    ];
    expect(
      checkOrphanBranches({
        branches,
        nowEpoch: NOW,
        ageDaysThreshold: 3,
      }),
    ).toHaveLength(1);
    expect(
      checkOrphanBranches({
        branches,
        nowEpoch: NOW,
        ageDaysThreshold: 7,
      }),
    ).toEqual([]);
  });

  it('embeds per-branch ageDays in context for dashboard rendering', () => {
    const branches = [
      {
        branch: 'feat/age-9d',
        committerTimeUnix: NOW - 9 * DAYS - 1 * HOURS,
        hasOpenPr: false,
      },
      {
        branch: 'feat/age-15d',
        committerTimeUnix: NOW - 15 * DAYS,
        hasOpenPr: false,
      },
    ];
    const findings = checkOrphanBranches({ branches, nowEpoch: NOW });
    const offenders = findings[0].context?.offenders as Array<{
      branch: string;
      ageDays: number;
    }>;
    expect(offenders).toHaveLength(2);
    expect(offenders.map((o) => o.branch).sort()).toEqual([
      'feat/age-15d',
      'feat/age-9d',
    ]);
    // ageDays is rounded; allow ±1 tolerance for rounding edges
    expect(offenders.find((o) => o.branch === 'feat/age-15d')!.ageDays).toBe(15);
  });
});

describe('preflightChecks (pre-spawn hook composite)', () => {
  it('returns no findings on a clean tree', () => {
    expect(
      preflightChecks({
        stashEntries: [],
        worktrees: [{ path: '/repo', branch: 'develop' }],
        dirtyTreeEntries: 0,
      }),
    ).toEqual([]);
  });

  it('flags every preflight predicate that fires', () => {
    const findings = preflightChecks({
      stashEntries: Array.from({ length: 6 }, () => 'stash@{}'),
      worktrees: Array.from({ length: 14 }, (_, i) => ({
        path: `/tmp/wt${i}`,
        branch: `f/${i}`,
      })),
      dirtyTreeEntries: 8,
    });
    expect(findings).toHaveLength(3);
    const ruleIds = findings.map((f) => f.ruleId).sort();
    expect(ruleIds).toEqual([
      'dirty-tree-cap-exceeded',
      'stash-accumulation',
      'worktree-cap-exceeded',
    ]);
    expect(findings.every((f) => ['high', 'medium'].includes(f.severity))).toBe(
      true,
    );
  });

  it('honours dirtyTreeBlockThreshold', () => {
    const findings = preflightChecks(
      {
        stashEntries: [],
        worktrees: [{ path: '/repo', branch: 'develop' }],
        dirtyTreeEntries: 4,
      },
      { dirtyTreeBlockThreshold: 3 },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('dirty-tree-cap-exceeded');
  });
});
