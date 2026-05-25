import { beforeEach, describe, expect, it } from 'vitest';

import {
  LifecycleAggregator,
  coerceAttestation,
  coerceEaReviewState,
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

describe('coerceAttestation — ADR-063 drop-list (out-of-DoD envelopes)', () => {
  it('drops legacy future-incoming envelopes (5th-steward retired)', () => {
    expect(
      coerceAttestation({
        steward: 'future-incoming',
        solutionId: 'sln-A',
        status: 'green',
        observedAt: T0.toISOString(),
      }),
    ).toBeNull();
  });
  it('drops pipeline-conductor drift envelopes (different gate, different runbook)', () => {
    expect(
      coerceAttestation({
        kind: 'policy.violation.detected',
        policy_id: 'P9',
        dispatch_id: 'd-1',
        caller_agent_id: 'pipeline-conductor',
      }),
    ).toBeNull();
    expect(
      coerceAttestation({
        kind: 'memory.consistency.broken',
        solutionId: 'sln-A',
        observedAt: T0.toISOString(),
      }),
    ).toBeNull();
    expect(
      coerceAttestation({
        kind: 'architecture.principle.violated',
        principle: 'P14',
      }),
    ).toBeNull();
  });
  it('drops drift-sentinel-shaped envelopes that try to masquerade as stewards', () => {
    expect(
      coerceAttestation({
        steward: 'drift-sentinel',
        solutionId: 'sln-A',
        status: 'red',
        observedAt: T0.toISOString(),
      }),
    ).toBeNull();
    expect(
      coerceAttestation({
        steward: 'pipeline-conductor',
        solutionId: 'sln-A',
        status: 'red',
        observedAt: T0.toISOString(),
      }),
    ).toBeNull();
  });
});

describe('coerceEaReviewState', () => {
  it('passes a well-formed approval envelope through', () => {
    const result = coerceEaReviewState({
      solutionId: 'sln-A',
      approved: true,
      at: T0.toISOString(),
      reviewer: 'ea-architect-agent',
    });
    expect(result).toEqual({
      solutionId: 'sln-A',
      approved: true,
      at: T0.toISOString(),
      reviewer: 'ea-architect-agent',
    });
  });
  it('infers approved=true when kind is ea-review-approved without explicit approved field', () => {
    const result = coerceEaReviewState({
      kind: 'ea-review-approved',
      solutionId: 'sln-A',
      at: T0.toISOString(),
    });
    expect(result?.approved).toBe(true);
  });
  it('infers approved=false from kind=ea-review-withdrawn', () => {
    const result = coerceEaReviewState({
      kind: 'ea-review-withdrawn',
      solutionId: 'sln-A',
      at: T0.toISOString(),
    });
    expect(result?.approved).toBe(false);
  });
  it('drops envelopes whose kind is unrelated', () => {
    expect(
      coerceEaReviewState({
        kind: 'policy.violation.detected',
        solutionId: 'sln-A',
        at: T0.toISOString(),
      }),
    ).toBeNull();
  });
  it('drops malformed envelopes', () => {
    expect(coerceEaReviewState(null)).toBeNull();
    expect(coerceEaReviewState({ approved: true })).toBeNull(); // missing solutionId + at
    expect(coerceEaReviewState({ solutionId: 'x', at: T0.toISOString() })).toBeNull(); // missing approved + no kind hint
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

  it('walks deploy → usage → activation → outcome with all-green attestations (4-steward)', async () => {
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    await agg.ingest(att('outcome', 'green'));
    expect(captured.map((c) => c.toState)).toEqual([
      'deployed',
      'built-into-active-app',
      'called-in-test',
      'producing-metrics',
    ]);
  });

  it('reaches producing-metrics on outcome green alone (no fifth steward gating)', async () => {
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    captured.length = 0;
    await agg.ingest(att('outcome', 'green'));
    expect(captured).toHaveLength(1);
    expect(captured[0]?.toState).toBe('producing-metrics');
    expect(agg.snapshot('sln-A')?.compositeState).toBe('producing-metrics');
    expect(agg.snapshot('sln-A')?.producingMetricsSinceMs).toBe(T0.getTime());
  });
});

describe('LifecycleAggregator — ADR-063 ignore-list for non-DoD envelopes', () => {
  it('ignores attestations whose steward field is `future-incoming` (envelopes dropped at type-guard)', async () => {
    const seen: { payload: unknown }[] = [];
    let pushed: ((e: { payload: unknown }) => void) | null = null;
    const src: AttestationEventSource = {
      subscribe(h): () => void {
        pushed = h;
        return (): void => {};
      },
    };
    const agg = new LifecycleAggregator({ now: () => T0, eventSources: [src] });

    // Push a future-incoming envelope through the event source.
    const fi = {
      steward: 'future-incoming',
      solutionId: 'sln-Z',
      status: 'green',
      observedAt: T0.toISOString(),
    };
    pushed!({ payload: fi });
    seen.push({ payload: fi });
    await new Promise((r) => setImmediate(r));

    // Counters: zero attestations ingested, one ignored envelope.
    expect(agg.attestationsIngested).toBe(0);
    expect(agg.ignoredEnvelopes).toBe(1);
    expect(agg.listSolutionIds()).toEqual([]);
  });

  it('ignores pipeline-conductor drift envelopes pushed onto the steward channel', async () => {
    let pushed: ((e: { payload: unknown }) => void) | null = null;
    const src: AttestationEventSource = {
      subscribe(h): () => void {
        pushed = h;
        return (): void => {};
      },
    };
    const agg = new LifecycleAggregator({ now: () => T0, eventSources: [src] });

    pushed!({
      payload: {
        kind: 'policy.violation.detected',
        policy_id: 'P9',
        dispatch_id: 'd-1',
        caller_agent_id: 'pipeline-conductor',
      },
    });
    pushed!({
      payload: {
        kind: 'architecture.principle.violated',
        principle: 'P14',
        actor: 'pipeline-conductor',
      },
    });
    await new Promise((r) => setImmediate(r));

    expect(agg.attestationsIngested).toBe(0);
    expect(agg.ignoredEnvelopes).toBe(2);
    expect(agg.listSolutionIds()).toEqual([]);
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

    // Sweep 1 — all four green.
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    await agg.ingest(att('outcome', 'green'));
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
    expect(agg.snapshot('sln-A')?.compositeState).not.toBe('producing-metrics');
  });
});

describe('LifecycleAggregator — getDodStatus + EA-review gate', () => {
  it('returns done=false for a fresh solution with missing stewards', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green'));
    const dod = agg.getDodStatus('sln-A');
    expect(dod?.done).toBe(false);
    expect(dod?.missing.usage).toBe('missing');
    expect(dod?.missing.activation).toBe('missing');
    expect(dod?.missing.outcome).toBe('missing');
    expect(dod?.eaReviewApproved).toBe(false);
  });

  it('returns null for unknown solutions', () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    expect(agg.getDodStatus('does-not-exist')).toBeNull();
  });

  it('DoD requires ea-review-approved AND holdover AND no drift AND all 4 stewards green+fresh', async () => {
    let now = T0;
    // Use generous freshness windows so attestations stay fresh
    // across the 24h holdover without needing per-2h re-attestation
    // (which would cause regression-to-degraded mid-test).
    const agg = new LifecycleAggregator({
      now: () => now,
      freshnessHoursOverride: {
        deploy: 48,
        usage: 48,
        activation: 48,
        outcome: 48,
      },
    });
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    await agg.ingest(att('outcome', 'green'));
    expect(agg.snapshot('sln-A')?.compositeState).toBe('producing-metrics');

    // Without EA approval, even a complete holdover keeps done=false.
    now = new Date(T0.getTime() + 24 * 3_600_000);
    let dod = agg.getDodStatus('sln-A');
    expect(dod?.holdoverHoursRemaining).toBe(0);
    expect(dod?.eaReviewApproved).toBe(false);
    expect(dod?.done).toBe(false);

    // Approve. All 4 stewards still fresh under the 48h window.
    agg.setEaReviewApproved('sln-A', true, now.toISOString());
    dod = agg.getDodStatus('sln-A');
    expect(dod?.eaReviewApproved).toBe(true);
    expect(dod?.missing).toEqual({});
    expect(dod?.done).toBe(true);
  });

  it('withdrawn EA approval flips done back to false', async () => {
    let now = T0;
    const agg = new LifecycleAggregator({
      now: () => now,
      freshnessHoursOverride: {
        deploy: 48,
        usage: 48,
        activation: 48,
        outcome: 48,
      },
    });
    await agg.ingest(att('deploy', 'green'));
    await agg.ingest(att('usage', 'green'));
    await agg.ingest(att('activation', 'green'));
    await agg.ingest(att('outcome', 'green'));
    now = new Date(T0.getTime() + 24 * 3_600_000);
    agg.setEaReviewApproved('sln-A', true, now.toISOString());
    expect(agg.getDodStatus('sln-A')?.done).toBe(true);
    agg.setEaReviewApproved('sln-A', false, now.toISOString());
    const dod = agg.getDodStatus('sln-A');
    expect(dod?.eaReviewApproved).toBe(false);
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

  it('attaches ea-review sources separately and routes envelopes to ingestEaReview', async () => {
    let handler: ((e: { payload: unknown }) => void) | null = null;
    const source: AttestationEventSource = {
      subscribe(h): () => void {
        handler = h;
        return (): void => {};
      },
    };
    const agg = new LifecycleAggregator({
      now: () => T0,
      eaReviewSources: [source],
    });
    handler!({
      payload: {
        kind: 'ea-review-approved',
        solutionId: 'sln-A',
        at: T0.toISOString(),
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(agg.eaReviewsIngested).toBe(1);
    expect(agg.snapshot('sln-A')?.eaReview?.approved).toBe(true);
  });
});

describe('LifecycleAggregator — DEFAULT_FRESHNESS_HOURS re-export', () => {
  it('matches the types module', () => {
    expect(DEFAULT_FRESHNESS_HOURS.deploy).toBeGreaterThan(0);
  });
});
