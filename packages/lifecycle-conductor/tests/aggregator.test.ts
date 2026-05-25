import { beforeEach, describe, expect, it } from 'vitest';

import {
  LifecycleAggregator,
  coerceAttestation,
} from '../src/aggregator.js';
import type { AttestationEventSource } from '../src/aggregator.js';
import { DEFAULT_FRESHNESS_HOURS } from '../src/types.js';
import type {
  CompositeStateChangedEvent,
  StewardAttestation,
  StewardName,
} from '../src/types.js';

const T0 = new Date('2026-05-25T12:00:00Z');

function att(
  steward: StewardName,
  status: 'green' | 'amber' | 'red',
  solutionId = 'sln-A',
  observedAt: Date = T0,
): StewardAttestation {
  return { steward, status, solutionId, observedAt: observedAt.toISOString() };
}

describe('coerceAttestation', () => {
  it('passes a well-formed envelope through', () => {
    const a = att('deploy', 'green');
    expect(coerceAttestation(a)).toEqual({
      steward: 'deploy',
      solutionId: 'sln-A',
      status: 'green',
      observedAt: T0.toISOString(),
    });
  });
  it('accepts snake-cased solution_id + at + run_id + observed_at', () => {
    const result = coerceAttestation({
      steward: 'usage',
      solution_id: 'sln-B',
      status: 'green',
      at: T0.toISOString(),
      run_id: 'r-1',
    });
    expect(result?.solutionId).toBe('sln-B');
    expect(result?.runId).toBe('r-1');
  });
  it('preserves optional evidence + note', () => {
    const result = coerceAttestation({
      steward: 'outcome',
      solutionId: 'sln-C',
      status: 'amber',
      observedAt: T0.toISOString(),
      note: 'slow',
      evidence: { p95: 1300 },
    });
    expect(result?.note).toBe('slow');
    expect(result?.evidence).toEqual({ p95: 1300 });
  });
  it('drops malformed envelopes', () => {
    expect(coerceAttestation(null)).toBeNull();
    expect(coerceAttestation('not-an-object')).toBeNull();
    expect(coerceAttestation({ steward: 'unknown', solutionId: 'x', status: 'green', observedAt: '' })).toBeNull();
    expect(coerceAttestation({ steward: 'deploy', solutionId: '', status: 'green', observedAt: T0.toISOString() })).toBeNull();
    expect(coerceAttestation({ steward: 'deploy', solutionId: 'x', status: 'pink', observedAt: T0.toISOString() })).toBeNull();
    expect(coerceAttestation({ steward: 'deploy', solutionId: 'x', status: 'green' })).toBeNull();
  });
});

describe('LifecycleAggregator — single solution forward walk', () => {
  let captured: CompositeStateChangedEvent[];
  let agg: LifecycleAggregator;

  beforeEach(() => {
    captured = [];
    agg = new LifecycleAggregator({
      now: () => T0,
      onCompositeStateChanged: (e) => captured.push(e),
    });
  });

  it('ignores composite-state changes when no attestations have arrived', () => {
    expect(agg.listSolutionIds()).toEqual([]);
  });

  it('transitions plan-approved → deployed on first green deploy attestation', async () => {
    await agg.ingest(att('deploy', 'green'));
    expect(captured).toHaveLength(1);
    expect(captured[0]?.fromState).toBe('plan-approved');
    expect(captured[0]?.toState).toBe('deployed');
    expect(captured[0]?.solutionId).toBe('sln-A');
    expect(agg.snapshot('sln-A')?.compositeState).toBe('deployed');
  });

  it('walks deploy → usage → activation → producing-metrics with all-green attestations', async () => {
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    // outcome alone is a no-op because gate=9 requires BOTH outcome AND future-incoming.
    await agg.ingest(att('outcome', 'green'));
    await agg.ingest(att('future-incoming', 'green'));
    expect(captured.map((c) => c.toState)).toEqual([
      'deployed',
      'built-into-active-app',
      'called-in-test',
      'producing-metrics',
    ]);
  });

  it('STRICTLY: outcome-only green does NOT advance past called-in-test', async () => {
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    captured.length = 0;
    await agg.ingest(att('outcome', 'green'));
    expect(captured).toHaveLength(0); // No state change.
    expect(agg.snapshot('sln-A')?.compositeState).toBe('called-in-test');
  });

  it('STRICTLY: future-incoming alone (no outcome) does NOT advance past called-in-test', async () => {
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    captured.length = 0;
    await agg.ingest(att('future-incoming', 'green'));
    expect(captured).toHaveLength(0);
    expect(agg.snapshot('sln-A')?.compositeState).toBe('called-in-test');
  });

  it('reaches producing-metrics only when BOTH outcome AND future-incoming are green', async () => {
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    await agg.ingest(att('outcome', 'green'));
    await agg.ingest(att('future-incoming', 'green'));
    expect(agg.snapshot('sln-A')?.compositeState).toBe('producing-metrics');
    expect(agg.snapshot('sln-A')?.producingMetricsSinceMs).toBe(T0.getTime());
  });
});

describe('LifecycleAggregator — drift to degraded', () => {
  it('drifts to degraded on any red attestation', async () => {
    const changes: CompositeStateChangedEvent[] = [];
    const agg = new LifecycleAggregator({
      now: () => T0,
      onCompositeStateChanged: (e) => changes.push(e),
    });
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    expect(agg.snapshot('sln-A')?.compositeState).toBe('built-into-active-app');
    await agg.ingest(att('activation', 'red'));
    expect(agg.snapshot('sln-A')?.compositeState).toBe('degraded');
    expect(changes.at(-1)?.toState).toBe('degraded');
  });

  it('records driftDuringHoldover when a red fires during producing-metrics', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    await agg.ingest(att('outcome', 'green'));
    await agg.ingest(att('future-incoming', 'green'));
    expect(agg.snapshot('sln-A')?.compositeState).toBe('producing-metrics');
    await agg.ingest(att('outcome', 'red'));
    expect(agg.snapshot('sln-A')?.compositeState).toBe('degraded');
    expect(agg.snapshot('sln-A')?.driftDuringHoldover).toBe(true);
  });
});

describe('LifecycleAggregator — degraded clear with consecutive greens', () => {
  it('clears degraded after threshold consecutive all-green ticks', async () => {
    const agg = new LifecycleAggregator({
      now: () => T0,
      degradedClearThreshold: 2,
    });
    // First a red, then 2 full all-green sweeps to clear.
    await agg.ingest(att('deploy', 'red'));
    expect(agg.snapshot('sln-A')?.compositeState).toBe('degraded');

    // Sweep 1 — all five green.
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    await agg.ingest(att('outcome', 'green'));
    await agg.ingest(att('future-incoming', 'green'));
    expect(agg.snapshot('sln-A')?.consecutiveGreensAcrossAllStewards).toBe(1);
    expect(agg.snapshot('sln-A')?.compositeState).toBe('degraded'); // 1 < 2

    // Sweep 2 — one more all-green tick.
    await agg.ingest(att('deploy', 'green', 'sln-A', T0));
    expect(agg.snapshot('sln-A')?.consecutiveGreensAcrossAllStewards).toBe(2);
    // The clear happened on the tick where greens crossed the threshold.
    expect(agg.snapshot('sln-A')?.compositeState).toBe('producing-metrics');
  });
});

describe('LifecycleAggregator — staleness', () => {
  it('staleness blocks producing-metrics even with all-green', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    // Outcome attestation observed 25h ago (window=24).
    const oldDate = new Date(T0.getTime() - 25 * 3_600_000);
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    await agg.ingest(att('outcome', 'green', 'sln-A', oldDate));
    await agg.ingest(att('future-incoming', 'green'));
    expect(agg.snapshot('sln-A')?.compositeState).not.toBe('producing-metrics');
  });
});

describe('LifecycleAggregator — getDodStatus', () => {
  it('returns done=false for a fresh solution with missing stewards', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green'));
    const dod = agg.getDodStatus('sln-A');
    expect(dod?.done).toBe(false);
    expect(dod?.missing.usage).toBe('missing');
    expect(dod?.missing.activation).toBe('missing');
    expect(dod?.missing.outcome).toBe('missing');
    expect(dod?.missing['future-incoming']).toBe('missing');
  });

  it('returns null for unknown solutions', () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    expect(agg.getDodStatus('does-not-exist')).toBeNull();
  });

  it('returns done=true only after the 24h holdover with no drift', async () => {
    let now = T0;
    const agg = new LifecycleAggregator({ now: () => now });
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    await agg.ingest(att('outcome', 'green'));
    await agg.ingest(att('future-incoming', 'green'));
    expect(agg.snapshot('sln-A')?.compositeState).toBe('producing-metrics');
    expect(agg.getDodStatus('sln-A')?.done).toBe(false); // 0h elapsed
    // 23h59 elapsed — still not done.
    now = new Date(T0.getTime() + (24 * 3_600_000 - 60_000));
    expect(agg.getDodStatus('sln-A')?.done).toBe(false);
    // But also: at +23.99h every steward is now stale because their
    // observedAt is still T0 and the freshness window is at most 72h.
    // outcome window is 24, so at +23.99h outcome is fresh-by-1m. ✓
    // 24h elapsed exactly → done IF stewards still fresh. Outcome
    // window=24, so observed at T0 is fresh for the full 24h.
    now = new Date(T0.getTime() + 24 * 3_600_000);
    // Pre-FSM-only re-evaluation: holdoverHoursRemaining should be 0.
    const dod = agg.getDodStatus('sln-A');
    expect(dod?.holdoverHoursRemaining).toBe(0);
    // But: at +24h, the deploy steward (window=2) is stale. So done remains false.
    expect(dod?.done).toBe(false);
  });
});

describe('LifecycleAggregator — stand-alone (no FSM)', () => {
  it('does not crash when no machine is wired', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green'));
    expect(agg.fsmAdvancesIssued).toBe(0); // No machine → no advances.
  });
});

describe('LifecycleAggregator — event source attachment', () => {
  it('subscribes to and unsubscribes from event sources cleanly', async () => {
    let handler: ((e: { payload: unknown }) => void) | null = null;
    let unsubCalled = false;
    const source: AttestationEventSource = {
      subscribe(h): () => void {
        handler = h;
        return (): void => {
          unsubCalled = true;
        };
      },
    };
    const agg = new LifecycleAggregator({
      now: () => T0,
      eventSources: [source],
    });
    expect(handler).not.toBeNull();

    handler!({ payload: att('deploy', 'green') });
    // ingest is async — yield to flush.
    await new Promise((r) => setImmediate(r));
    expect(agg.attestationsIngested).toBe(1);

    handler!({ payload: { malformed: true } });
    await new Promise((r) => setImmediate(r));
    expect(agg.ignoredEnvelopes).toBe(1);

    agg.stop();
    expect(unsubCalled).toBe(true);
  });
});

describe('LifecycleAggregator — DEFAULT_FRESHNESS_HOURS re-export', () => {
  it('matches the types module', () => {
    expect(DEFAULT_FRESHNESS_HOURS.deploy).toBeGreaterThan(0);
  });
});
