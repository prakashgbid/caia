import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aggregatePhaseStats,
  calibratePhase,
  percentile,
  renderJson,
  renderMarkdown,
  renderCalibration,
} from '../src/stats.js';

interface AuditLine {
  ts: string;
  event: string;
  [k: string]: unknown;
}

function writeAudit(chainDir: string, lines: AuditLine[]): void {
  mkdirSync(chainDir, { recursive: true });
  const body = lines.map((l) => JSON.stringify(l)).join('\n');
  writeFileSync(join(chainDir, 'audit.jsonl'), `${body}\n`);
}

describe('percentile', () => {
  it('returns null for empty', () => {
    expect(percentile([], 50)).toBeNull();
  });
  it('returns the single value for length-1', () => {
    expect(percentile([10], 95)).toBe(10);
  });
  it('returns mid for length-2 p50', () => {
    expect(percentile([10, 20], 50)).toBe(15);
  });
  it('interpolates between adjacent values', () => {
    // p95 of [0..100] (step 10): idx = 0.95 * 10 = 9.5 → between 90 and 100 = 95
    const data = Array.from({ length: 11 }, (_, i) => i * 10);
    expect(percentile(data, 95)).toBe(95);
  });
  it('returns max for p100', () => {
    expect(percentile([1, 2, 3], 100)).toBe(3);
  });
});

describe('aggregatePhaseStats', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cr-stats-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty result when root is missing', () => {
    const result = aggregatePhaseStats({ chainRoot: join(root, 'missing') });
    expect(result.rows).toEqual([]);
    expect(result.eventsParsed).toBe(0);
  });

  it('pairs phase_in_progress with phase_done by session_id', () => {
    writeAudit(join(root, 'demo'), [
      { ts: '2026-05-13T00:00:00Z', event: 'state_init', phases: 2 },
      {
        ts: '2026-05-13T00:00:10Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 'sess-1',
        attempt: 1,
      },
      {
        ts: '2026-05-13T00:02:10Z',
        event: 'phase_done',
        phase_id: 1,
        session_id: 'sess-1',
      },
    ]);
    const agg = aggregatePhaseStats({ chainRoot: root });
    expect(agg.rows).toHaveLength(1);
    const row = agg.rows[0]!;
    expect(row.chainId).toBe('demo');
    expect(row.phaseId).toBe(1);
    expect(row.successCount).toBe(1);
    expect(row.durationsSec).toEqual([120]);
    expect(row.p50Sec).toBe(120);
    expect(row.failureCount).toBe(0);
    expect(row.inFlightCount).toBe(0);
  });

  it('records failure_class from phase_failed', () => {
    writeAudit(join(root, 'demo'), [
      {
        ts: '2026-05-13T00:00:10Z',
        event: 'phase_in_progress',
        phase_id: 2,
        session_id: 's2',
        attempt: 1,
      },
      {
        ts: '2026-05-13T00:05:10Z',
        event: 'phase_failed',
        phase_id: 2,
        reason: 'rate_limit_hit',
        class: 'worker_no_start_rate_limit',
        session_id: 's2',
      },
    ]);
    const agg = aggregatePhaseStats({ chainRoot: root });
    expect(agg.rows).toHaveLength(1);
    const row = agg.rows[0]!;
    expect(row.failureCount).toBe(1);
    expect(row.failureClasses).toEqual({ worker_no_start_rate_limit: 1 });
    expect(row.successCount).toBe(0);
    expect(row.inFlightCount).toBe(0);
  });

  it('counts unmatched in_progress as in-flight', () => {
    writeAudit(join(root, 'demo'), [
      {
        ts: '2026-05-13T00:00:10Z',
        event: 'phase_in_progress',
        phase_id: 3,
        session_id: 'never-finished',
        attempt: 1,
      },
    ]);
    const agg = aggregatePhaseStats({ chainRoot: root });
    expect(agg.rows[0]?.inFlightCount).toBe(1);
    expect(agg.rows[0]?.successCount).toBe(0);
  });

  it('falls back to phase-id pairing when session_id is missing on phase_done', () => {
    writeAudit(join(root, 'demo'), [
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 4,
        session_id: 'legacy-sess',
        attempt: 1,
      },
      // Legacy phase_done with no session_id (mimics older audit lines).
      { ts: '2026-05-13T00:03:00Z', event: 'phase_done', phase_id: 4 },
    ]);
    const agg = aggregatePhaseStats({ chainRoot: root });
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0]?.successCount).toBe(1);
    expect(agg.rows[0]?.durationsSec).toEqual([180]);
  });

  it('walks multiple chains and produces stable ordering', () => {
    writeAudit(join(root, 'beta'), [
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 'b1',
        attempt: 1,
      },
      {
        ts: '2026-05-13T00:01:00Z',
        event: 'phase_done',
        phase_id: 1,
        session_id: 'b1',
      },
    ]);
    writeAudit(join(root, 'alpha'), [
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 'a1',
        attempt: 1,
      },
      {
        ts: '2026-05-13T00:01:00Z',
        event: 'phase_done',
        phase_id: 1,
        session_id: 'a1',
      },
    ]);
    const agg = aggregatePhaseStats({ chainRoot: root });
    expect(agg.rows.map((r) => r.chainId)).toEqual(['alpha', 'beta']);
  });

  it('respects sinceIso filter', () => {
    writeAudit(join(root, 'demo'), [
      {
        ts: '2026-05-01T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 'old',
        attempt: 1,
      },
      { ts: '2026-05-01T00:01:00Z', event: 'phase_done', phase_id: 1, session_id: 'old' },
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 2,
        session_id: 'new',
        attempt: 1,
      },
      { ts: '2026-05-13T00:02:00Z', event: 'phase_done', phase_id: 2, session_id: 'new' },
    ]);
    const agg = aggregatePhaseStats({ chainRoot: root, sinceIso: '2026-05-10T00:00:00Z' });
    // Only the newer phase should be present.
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0]?.phaseId).toBe(2);
  });

  it('handles malformed audit lines without throwing', () => {
    const dir = join(root, 'demo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'audit.jsonl'),
      '{"ts":"2026-05-13T00:00:00Z","event":"wake"}\n' +
        'not-json-at-all\n' +
        '{"ts":"2026-05-13T00:00:05Z","event":"phase_in_progress","phase_id":1,"session_id":"x","attempt":1}\n' +
        '{"ts":"2026-05-13T00:01:05Z","event":"phase_done","phase_id":1,"session_id":"x"}\n',
    );
    const agg = aggregatePhaseStats({ chainRoot: root });
    expect(agg.eventsSkipped).toBe(1);
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0]?.successCount).toBe(1);
  });

  it('renders a markdown summary', () => {
    writeAudit(join(root, 'demo'), [
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 's',
        attempt: 1,
      },
      { ts: '2026-05-13T00:01:00Z', event: 'phase_done', phase_id: 1, session_id: 's' },
    ]);
    const md = renderMarkdown(aggregatePhaseStats({ chainRoot: root }));
    expect(md).toMatch(/# chain-runner phase stats/);
    expect(md).toMatch(/demo \| 1 \|/);
  });

  it('renders JSON parseable result', () => {
    writeAudit(join(root, 'demo'), [
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 's',
        attempt: 1,
      },
      { ts: '2026-05-13T00:01:00Z', event: 'phase_done', phase_id: 1, session_id: 's' },
    ]);
    const parsed = JSON.parse(renderJson(aggregatePhaseStats({ chainRoot: root }))) as {
      rows: unknown[];
    };
    expect(Array.isArray(parsed.rows)).toBe(true);
  });
});

describe('calibratePhase (H-20)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cr-cal-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null suggestion when no data', () => {
    const r = calibratePhase(1, { chainRoot: root });
    expect(r.suggestedMaxMinutes).toBeNull();
    expect(r.observations).toBe(0);
    expect(r.rationale).toMatch(/No successful runs/);
  });

  it('computes p95 across multiple chains for the same phase', () => {
    // Phase 1 took 60s in chain-a, 120s in chain-b, 600s in chain-c
    for (const [chain, sec] of [
      ['chain-a', 60],
      ['chain-b', 120],
      ['chain-c', 600],
    ] as const) {
      const start = '2026-05-13T00:00:00Z';
      const end = new Date(new Date(start).getTime() + sec * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
      writeAudit(join(root, chain), [
        { ts: start, event: 'phase_in_progress', phase_id: 1, session_id: chain, attempt: 1 },
        { ts: end, event: 'phase_done', phase_id: 1, session_id: chain },
      ]);
    }
    const r = calibratePhase(1, { chainRoot: root });
    expect(r.observations).toBe(3);
    // p95 of [60,120,600] = lerp idx 1.9 → 120 + 0.9*(600-120) = 552
    expect(r.pSec).toBeCloseTo(552, 0);
    // Recommended max_minutes = ceil(552 * 1.5 / 60) = 14
    expect(r.suggestedMaxMinutes).toBe(14);
    expect(r.rationale).toMatch(/p95/);
  });

  it('respects --chain restriction', () => {
    writeAudit(join(root, 'chain-a'), [
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 'sa',
        attempt: 1,
      },
      { ts: '2026-05-13T00:00:30Z', event: 'phase_done', phase_id: 1, session_id: 'sa' },
    ]);
    writeAudit(join(root, 'chain-b'), [
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 'sb',
        attempt: 1,
      },
      { ts: '2026-05-13T01:00:00Z', event: 'phase_done', phase_id: 1, session_id: 'sb' },
    ]);
    const onlyA = calibratePhase(1, { chainRoot: root, chainId: 'chain-a' });
    expect(onlyA.observations).toBe(1);
    expect(onlyA.pSec).toBe(30);
    const both = calibratePhase(1, { chainRoot: root });
    expect(both.observations).toBe(2);
  });

  it('caps suggestion at minimum of 5 minutes', () => {
    writeAudit(join(root, 'chain-a'), [
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 'x',
        attempt: 1,
      },
      { ts: '2026-05-13T00:00:05Z', event: 'phase_done', phase_id: 1, session_id: 'x' },
    ]);
    const r = calibratePhase(1, { chainRoot: root });
    // p95(5s) → ceil(7.5/60)=1, floor enforces minimum 5
    expect(r.suggestedMaxMinutes).toBe(5);
  });

  it('renders text output containing the rationale', () => {
    writeAudit(join(root, 'demo'), [
      {
        ts: '2026-05-13T00:00:00Z',
        event: 'phase_in_progress',
        phase_id: 1,
        session_id: 's',
        attempt: 1,
      },
      { ts: '2026-05-13T00:10:00Z', event: 'phase_done', phase_id: 1, session_id: 's' },
    ]);
    const out = renderCalibration(calibratePhase(1, { chainRoot: root }));
    expect(out).toMatch(/calibrate phase=1/);
    expect(out).toMatch(/suggested_max_minutes/);
  });
});
