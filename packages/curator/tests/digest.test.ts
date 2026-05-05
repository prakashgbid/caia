/**
 * Unit tests for the digest renderer.
 *
 * Pure function — verifies sectioning, ranking integration, sentinel
 * empty-list rendering.
 */

import { describe, it, expect } from 'vitest';

import { renderDigest } from '../src/digest.js';
import type { Finding, ScanRunResult } from '../src/types.js';

function mkResult(findings: Finding[]): ScanRunResult {
  return {
    startedAt: '2026-05-05T01:00:00Z',
    endedAt: '2026-05-05T01:00:30Z',
    findings,
    perScanner: [
      {
        scannerId: 'test-scanner',
        name: 'test',
        durationMs: 30000,
        findingCount: findings.length,
        error: null
      }
    ]
  };
}

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    scannerId: 'sc',
    dimension: 'Test dim',
    category: 'Code Health & Maintainability',
    severity: 'medium',
    title: 'titl',
    detail: 'det',
    evidence: ['ev1'],
    recommendation: 'reco',
    effort: 'medium',
    impactScore: 50,
    detectedAt: '2026-05-05T01:00:00Z',
    ...overrides
  };
}

describe('renderDigest', () => {
  it('renders a header with the date', () => {
    const md = renderDigest(mkResult([]), { date: new Date('2026-05-05T01:00:00Z') });
    expect(md).toContain('# Curator Digest — 2026-05-05');
  });

  it('shows a sentinel when there are no findings', () => {
    const md = renderDigest(mkResult([]));
    expect(md).toContain('No findings');
  });

  it('renders top findings in priority order', () => {
    const a = mkFinding({ title: 'low-prio', severity: 'low', impactScore: 20, effort: 'large' });
    const b = mkFinding({ title: 'high-prio', severity: 'high', impactScore: 80, effort: 'trivial' });
    const md = renderDigest(mkResult([a, b]));
    const aIdx = md.indexOf('low-prio');
    const bIdx = md.indexOf('high-prio');
    expect(bIdx).toBeGreaterThan(0);
    expect(aIdx).toBeGreaterThan(bIdx);
  });

  it('respects topN', () => {
    const findings = Array.from({ length: 25 }, (_, i) =>
      mkFinding({ title: `f-${i}`, impactScore: 100 - i })
    );
    const md = renderDigest(mkResult(findings), { topN: 5 });
    expect(md).toContain('## Top 5 findings');
    expect(md).toContain('f-0');
    expect(md).toContain('f-4');
    expect(md).not.toContain('### 6.');
  });

  it('groups all-findings by category', () => {
    const a = mkFinding({ category: 'Security & Trust', title: 'a-sec' });
    const b = mkFinding({ category: 'Reliability & Resilience', title: 'b-rel' });
    const md = renderDigest(mkResult([a, b]));
    expect(md).toContain('### Security & Trust');
    expect(md).toContain('### Reliability & Resilience');
    expect(md).toContain('a-sec');
    expect(md).toContain('b-rel');
  });

  it('includes the scanner-run summary table', () => {
    const md = renderDigest(mkResult([]));
    expect(md).toContain('## Scanner run summary');
    expect(md).toContain('| Scanner | Duration (ms) | Findings | Error |');
    expect(md).toContain('test-scanner');
  });

  it('uses severity labels (no emoji)', () => {
    const md = renderDigest(mkResult([mkFinding({ severity: 'critical' })]));
    expect(md).toContain('[CRITICAL]');
  });

  it('renders evidence as a bullet list when present', () => {
    const md = renderDigest(mkResult([
      mkFinding({ evidence: ['e1', 'e2', 'e3'] })
    ]));
    expect(md).toContain('- e1');
    expect(md).toContain('- e2');
    expect(md).toContain('- e3');
  });
});
