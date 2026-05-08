import { describe, it, expect } from 'vitest';

import { coordinateApprenticeLoop } from '../src/coordinate-apprentice-loop.js';
import { resolveConfig } from '../src/config.js';
import {
  buildFakeAdapterRegistry,
  buildFakeCurator,
  buildFakeMentor,
  fixedClock
} from './helpers/fakes.js';

const NOW_ISO = '2026-05-06T12:00:00Z';
const NOW_MS = new Date(NOW_ISO).getTime();
const HOUR_MS = 60 * 60 * 1000;

describe('coordinateApprenticeLoop', () => {
  const cfg = resolveConfig({});
  const clock = fixedClock(NOW_ISO);

  it('returns hold when no signals present', () => {
    const plan = coordinateApprenticeLoop({
      cfg,
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      clock
    });
    expect(plan.decision).toBe('hold');
  });

  it('returns rollback when ≥3 regressions in 24h', () => {
    const events = [0, 1, 2, 3].map((i) => ({
      id: `e${i}`,
      type: 'RegressionDetected',
      emittedAtMs: NOW_MS - i * HOUR_MS,
      payload: {}
    }));
    const plan = coordinateApprenticeLoop({
      cfg,
      mentor: buildFakeMentor(events),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      clock
    });
    expect(plan.decision).toBe('rollback');
  });

  it('returns promote-canary when an unblessed candidate passes threshold', () => {
    const plan = coordinateApprenticeLoop({
      cfg,
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([
        {
          name: 'apprentice-cand-2026-05-06',
          path: '/tmp/cand',
          winRate: 0.7,
          forgettingFlags: 0
        }
      ]),
      clock
    });
    expect(plan.decision).toBe('promote-canary');
    expect(plan.candidateAdapterPath).toBe('/tmp/cand');
  });

  it('skips a candidate that already has blessedAtMs', () => {
    const plan = coordinateApprenticeLoop({
      cfg,
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([
        {
          name: 'apprentice-cand-2026-05-06',
          path: '/tmp/cand',
          winRate: 0.7,
          forgettingFlags: 0,
          blessedAtMs: NOW_MS - HOUR_MS
        }
      ]),
      clock
    });
    expect(plan.decision).not.toBe('promote-canary');
  });

  it('returns retrain when failure threshold exceeded', () => {
    const events = [
      'HallucinationFlagged',
      'HallucinationFlagged',
      'HallucinationFlagged',
      'EvidenceGateFailure',
      'EvidenceGateFailure',
      'ToolMisuseFlagged'
    ].map((t, i) => ({
      id: `e${i}`,
      type: t,
      emittedAtMs: NOW_MS - i * HOUR_MS,
      payload: {}
    }));
    const plan = coordinateApprenticeLoop({
      cfg,
      mentor: buildFakeMentor(events),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      clock
    });
    expect(plan.decision).toBe('retrain');
    expect(plan.failureSignals.length).toBeGreaterThan(0);
  });

  it('reports curator cost signals', () => {
    const plan = coordinateApprenticeLoop({
      cfg,
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([
        {
          scannerId: 'cost-scan',
          category: 'Subscription & Resource Efficiency',
          dimension: 'subscription-cost',
          severity: 'high',
          title: 'Subscription cost spike',
          detail: '50% over baseline',
          detectedAtMs: NOW_MS
        }
      ]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      clock
    });
    expect(plan.costSignals).toHaveLength(1);
    expect(plan.costSignals[0]!.severity).toBe('high');
  });

  it('ignores curator findings outside cost category', () => {
    const plan = coordinateApprenticeLoop({
      cfg,
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([
        {
          scannerId: 'memory',
          category: 'Code Health & Maintainability',
          dimension: 'memory-drift',
          severity: 'high',
          title: '...',
          detail: '...',
          detectedAtMs: NOW_MS
        }
      ]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      clock
    });
    expect(plan.costSignals).toHaveLength(0);
  });
});
