import { describe, it, expect } from 'vitest';
import {
  checkPrStaleness,
  checkDependabotTriage,
  groupDependabotByEcosystem,
} from '../src/pr-state.js';

const NOW_MS = 1779840000_000; // 2026-05-04 06:00:00 UTC
const DAY_MS = 86_400_000;

function isoDaysAgo(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

describe('checkPrStaleness (failure mode #10)', () => {
  it('returns no findings for fresh PRs', () => {
    const prs = [
      {
        number: 100,
        title: 'recent',
        branch: 'feat/x',
        updatedAt: isoDaysAgo(2),
        labels: [],
        isDraft: false,
        author: 'user',
      },
    ];
    expect(checkPrStaleness({ prs, nowMs: NOW_MS })).toEqual([]);
  });

  it('flags PRs idle 14-29d as warn (medium)', () => {
    const prs = [
      {
        number: 200,
        title: 'mid-stale',
        branch: 'feat/y',
        updatedAt: isoDaysAgo(20),
        labels: [],
        isDraft: false,
        author: 'user',
      },
    ];
    const findings = checkPrStaleness({ prs, nowMs: NOW_MS });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('pr-stale-warn');
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].context?.ageDays).toBe(20);
  });

  it('flags PRs idle >=30d as auto-close eligible', () => {
    const prs = [
      {
        number: 201,
        title: 'very stale',
        branch: 'feat/z',
        updatedAt: isoDaysAgo(35),
        labels: [],
        isDraft: false,
        author: 'user',
      },
    ];
    const findings = checkPrStaleness({ prs, nowMs: NOW_MS });
    expect(findings[0].ruleId).toBe('pr-stale-auto-close');
    expect(findings[0].context?.eligibleForAutoClose).toBe(true);
    expect(findings[0].remediation).toContain('gh pr close 201');
  });

  it('skips PRs with keep-open label', () => {
    const prs = [
      {
        number: 202,
        title: 'tracking',
        branch: 'feat/track',
        updatedAt: isoDaysAgo(60),
        labels: ['keep-open'],
        isDraft: false,
        author: 'user',
      },
    ];
    expect(checkPrStaleness({ prs, nowMs: NOW_MS })).toEqual([]);
  });

  it('does not auto-close dependabot PRs (handled by failure mode #11)', () => {
    const prs = [
      {
        number: 300,
        title: 'bump fastify',
        branch: 'dependabot/npm/fastify-5',
        updatedAt: isoDaysAgo(45),
        labels: [],
        isDraft: false,
        author: 'app/dependabot',
      },
    ];
    const findings = checkPrStaleness({ prs, nowMs: NOW_MS });
    expect(findings[0].ruleId).toBe('pr-stale-warn');
    expect(findings[0].context?.eligibleForAutoClose).toBe(false);
  });

  it('honours custom skipAutoCloseAuthors', () => {
    const prs = [
      {
        number: 301,
        title: 'special',
        branch: 'feat/x',
        updatedAt: isoDaysAgo(45),
        labels: [],
        isDraft: false,
        author: 'app/special-bot',
      },
    ];
    const findings = checkPrStaleness({
      prs,
      nowMs: NOW_MS,
      skipAutoCloseAuthors: ['app/special-bot'],
    });
    expect(findings[0].context?.eligibleForAutoClose).toBe(false);
  });
});

describe('checkDependabotTriage (failure mode #11)', () => {
  it('returns no findings for clean dependabot PRs', () => {
    const prs = [
      {
        number: 100,
        title: 'bump x',
        branch: 'dependabot/npm/x',
        updatedAt: isoDaysAgo(2),
        mergeStateStatus: 'CLEAN' as const,
        ecosystem: 'npm',
      },
    ];
    expect(checkDependabotTriage({ prs, nowMs: NOW_MS })).toEqual([]);
  });

  it('flags DIRTY dependabot PRs older than 7d as medium', () => {
    const prs = [
      {
        number: 101,
        title: 'bump y',
        branch: 'dependabot/npm/y',
        updatedAt: isoDaysAgo(10),
        mergeStateStatus: 'DIRTY' as const,
        ecosystem: 'npm',
      },
    ];
    const findings = checkDependabotTriage({ prs, nowMs: NOW_MS });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
  });

  it('escalates DIRTY dependabot PRs older than 30d to high', () => {
    const prs = [
      {
        number: 102,
        title: 'bump z',
        branch: 'dependabot/pip/z',
        updatedAt: isoDaysAgo(45),
        mergeStateStatus: 'DIRTY' as const,
        ecosystem: 'pip',
      },
    ];
    const findings = checkDependabotTriage({ prs, nowMs: NOW_MS });
    expect(findings[0].severity).toBe('high');
    expect(findings[0].context?.ecosystem).toBe('pip');
  });

  it('skips non-DIRTY merge states (CLEAN, BEHIND, etc.)', () => {
    const prs = [
      {
        number: 103,
        title: 'bump w',
        branch: 'dependabot/npm/w',
        updatedAt: isoDaysAgo(40),
        mergeStateStatus: 'BEHIND' as const,
        ecosystem: 'npm',
      },
    ];
    expect(checkDependabotTriage({ prs, nowMs: NOW_MS })).toEqual([]);
  });

  it('groups findings by ecosystem for triage rendering', () => {
    const prs = [
      {
        number: 110,
        title: 'npm-1',
        branch: 'dependabot/npm/a',
        updatedAt: isoDaysAgo(10),
        mergeStateStatus: 'DIRTY' as const,
        ecosystem: 'npm',
      },
      {
        number: 111,
        title: 'npm-2',
        branch: 'dependabot/npm/b',
        updatedAt: isoDaysAgo(20),
        mergeStateStatus: 'DIRTY' as const,
        ecosystem: 'npm',
      },
      {
        number: 112,
        title: 'docker',
        branch: 'dependabot/docker/c',
        updatedAt: isoDaysAgo(15),
        mergeStateStatus: 'DIRTY' as const,
        ecosystem: 'docker',
      },
    ];
    const findings = checkDependabotTriage({ prs, nowMs: NOW_MS });
    const grouped = groupDependabotByEcosystem(findings);
    expect(grouped.npm).toHaveLength(2);
    expect(grouped.docker).toHaveLength(1);
  });
});
