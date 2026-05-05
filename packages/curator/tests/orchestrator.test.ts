/**
 * Unit tests for the orchestrator (runScan + rankFindings).
 *
 * Pure functions — no I/O.
 */

import { describe, it, expect } from 'vitest';

import { rankFindings, runScan } from '../src/orchestrator.js';
import type { Finding, ScanContext, Scanner } from '../src/types.js';

function mkCtx(overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    repoRoot: '/tmp/repo',
    memoryDir: '/tmp/memory',
    reportsDir: '/tmp/reports',
    runShell: () => '',
    env: {},
    now: () => new Date('2026-05-05T01:00:00Z'),
    ...overrides
  };
}

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    scannerId: 'test',
    dimension: 'Test',
    category: 'Code Health & Maintainability',
    severity: 'medium',
    title: 'a finding',
    detail: 'detail',
    evidence: ['evidence-1'],
    recommendation: 'do x',
    effort: 'medium',
    impactScore: 50,
    detectedAt: '2026-05-05T01:00:00Z',
    ...overrides
  };
}

describe('runScan', () => {
  it('runs each scanner in order and aggregates findings', async () => {
    const sc1: Scanner = {
      id: 's1',
      name: 'scanner-1',
      category: 'Code Health & Maintainability',
      scan: () => [mkFinding({ scannerId: 's1', title: 'a' })]
    };
    const sc2: Scanner = {
      id: 's2',
      name: 'scanner-2',
      category: 'Security & Trust',
      scan: () => [
        mkFinding({ scannerId: 's2', title: 'b' }),
        mkFinding({ scannerId: 's2', title: 'c' })
      ]
    };
    const r = await runScan([sc1, sc2], mkCtx());
    expect(r.findings.length).toBe(3);
    expect(r.findings.map((f) => f.title)).toEqual(['a', 'b', 'c']);
    expect(r.perScanner.length).toBe(2);
    expect(r.perScanner[0]?.scannerId).toBe('s1');
    expect(r.perScanner[0]?.findingCount).toBe(1);
    expect(r.perScanner[1]?.findingCount).toBe(2);
    expect(r.startedAt).toBeTruthy();
    expect(r.endedAt).toBeTruthy();
  });

  it('catches scanner errors and continues with other scanners', async () => {
    const sc1: Scanner = {
      id: 's1',
      name: 'scanner-1',
      category: 'Code Health & Maintainability',
      scan: () => {
        throw new Error('boom');
      }
    };
    const sc2: Scanner = {
      id: 's2',
      name: 'scanner-2',
      category: 'Security & Trust',
      scan: () => [mkFinding({ scannerId: 's2', title: 'survived' })]
    };
    const r = await runScan([sc1, sc2], mkCtx());
    expect(r.findings.length).toBe(1);
    expect(r.findings[0]?.title).toBe('survived');
    expect(r.perScanner[0]?.error).toContain('boom');
    expect(r.perScanner[1]?.error).toBeNull();
  });

  it('records per-scanner durationMs', async () => {
    const sc: Scanner = {
      id: 's',
      name: 'slow',
      category: 'Reliability & Resilience',
      scan: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [];
      }
    };
    const r = await runScan([sc], mkCtx());
    expect(r.perScanner[0]?.durationMs).toBeGreaterThanOrEqual(15);
  });
});

describe('rankFindings', () => {
  it('puts critical findings first regardless of impact/effort', () => {
    const a = mkFinding({ severity: 'critical', impactScore: 1, effort: 'xlarge' });
    const b = mkFinding({ severity: 'high', impactScore: 90, effort: 'trivial' });
    const ranked = rankFindings([b, a]);
    expect(ranked[0]?.severity).toBe('critical');
  });

  it('ranks non-critical by impact / effortWeight', () => {
    // higher impact + lower effort = higher priority
    const high = mkFinding({ impactScore: 80, effort: 'trivial', title: 'high-prio' });
    const mid = mkFinding({ impactScore: 80, effort: 'medium', title: 'mid-prio' });
    const low = mkFinding({ impactScore: 30, effort: 'large', title: 'low-prio' });
    const ranked = rankFindings([low, mid, high]);
    expect(ranked.map((f) => f.title)).toEqual(['high-prio', 'mid-prio', 'low-prio']);
  });

  it('returns a new array (does not mutate input)', () => {
    const input = [mkFinding({ title: 'a' }), mkFinding({ title: 'b' })];
    const inputCopy = [...input];
    rankFindings(input);
    expect(input).toEqual(inputCopy);
  });

  it('handles empty findings list', () => {
    expect(rankFindings([])).toEqual([]);
  });
});
