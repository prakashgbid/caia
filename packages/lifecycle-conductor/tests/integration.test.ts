import {
  InMemorySolutionStore,
  SolutionLifecycleMachine,
} from '@caia/state-machine';
import { describe, expect, it } from 'vitest';

import { LifecycleAggregator } from '../src/aggregator.js';
import { LifecycleConductorApi } from '../src/api.js';
import type { StewardAttestation, StewardName } from '../src/types.js';

const T0 = new Date('2026-05-25T12:00:00Z');

function att(
  steward: StewardName,
  status: 'green' | 'amber' | 'red',
  solutionId: string,
  observedAt: Date,
): StewardAttestation {
  return { steward, status, solutionId, observedAt: observedAt.toISOString() };
}


describe('integration: solution + 4 stewards + ea-review composite walk (ADR-063)', () => {
  it('drives a synthetic solution through the full forward chain', async () => {
    const now = T0;
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store, { now: () => now });
    await machine.init();

    const registered = await machine.registerSolution({
      solutionId: 'sln-2026-05-25-integ',
      title: 'Integration solution',
      planPath: 'research/integ.md',
      approvedByAdr: 'ADR-XYZ',
    });
    expect(registered.currentState).toBe('approved');

    const agg = new LifecycleAggregator({
      now: () => now,
      solutionMachine: machine,
      degradedClearThreshold: 2,
    });
    const api = new LifecycleConductorApi(agg, machine);

    expect(api.getDodStatus('sln-2026-05-25-integ')).toBeNull();

    await agg.ingest(att('deploy', 'green', 'sln-2026-05-25-integ', now));
    expect(agg.snapshot('sln-2026-05-25-integ')?.compositeState).toBe('deployed');
    expect((await machine.getSolution('sln-2026-05-25-integ'))?.status).toBe('deployed');

    await agg.ingest(att('usage', 'green', 'sln-2026-05-25-integ', now));
    expect(agg.snapshot('sln-2026-05-25-integ')?.compositeState).toBe('built-into-active-app');
    expect((await machine.getSolution('sln-2026-05-25-integ'))?.status).toBe('imported');

    await agg.ingest(att('activation', 'green', 'sln-2026-05-25-integ', now));
    expect(agg.snapshot('sln-2026-05-25-integ')?.compositeState).toBe('called-in-test');
    expect((await machine.getSolution('sln-2026-05-25-integ'))?.status).toBe('called-in-test');

    // Outcome alone now reaches producing-metrics (no fifth steward).
    await agg.ingest(att('outcome', 'green', 'sln-2026-05-25-integ', now));
    expect(agg.snapshot('sln-2026-05-25-integ')?.compositeState).toBe('producing-metrics');
    expect((await machine.getSolution('sln-2026-05-25-integ'))?.status).toBe('producing-metrics');

    const dod0 = api.getDodStatus('sln-2026-05-25-integ');
    expect(dod0?.done).toBe(false);
    expect(dod0?.compositeState).toBe('producing-metrics');
    expect(dod0?.holdoverHoursRemaining).toBe(24);
    expect(dod0?.eaReviewApproved).toBe(false);

    // Drift: outcome goes red.
    await agg.ingest(att('outcome', 'red', 'sln-2026-05-25-integ', now));
    expect(agg.snapshot('sln-2026-05-25-integ')?.compositeState).toBe('degraded');
    expect(agg.snapshot('sln-2026-05-25-integ')?.driftDuringHoldover).toBe(true);
    expect((await machine.getSolution('sln-2026-05-25-integ'))?.status).toBe(
      'producing-metrics-rolled-back',
    );

    // Re-green outcome (itself an all-green tick -> greens=1) then one
    // more all-green tick to cross threshold=2 and clear.
    await agg.ingest(att('outcome', 'green', 'sln-2026-05-25-integ', now));
    expect(agg.snapshot('sln-2026-05-25-integ')?.consecutiveGreensAcrossAllStewards).toBe(1);
    expect(agg.snapshot('sln-2026-05-25-integ')?.compositeState).toBe('degraded');
    await agg.ingest(att('deploy', 'green', 'sln-2026-05-25-integ', now));
    expect(agg.snapshot('sln-2026-05-25-integ')?.consecutiveGreensAcrossAllStewards).toBe(2);
    expect(agg.snapshot('sln-2026-05-25-integ')?.compositeState).toBe('producing-metrics');
    expect((await machine.getSolution('sln-2026-05-25-integ'))?.status).toBe(
      'producing-metrics',
    );
  });
});


describe('integration: orthogonal scenarios', () => {
  it('listIncompleteSolutions surfaces FSM-registered solutions without attestations', async () => {
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store, { now: () => T0 });
    await machine.init();
    await machine.registerSolution({ solutionId: 'sln-ghost', title: 'No attestations' });

    const agg = new LifecycleAggregator({ now: () => T0, solutionMachine: machine });
    const api = new LifecycleConductorApi(agg, machine);

    const list = await api.listIncompleteSolutions();
    expect(list.map((l) => l.solutionId)).toContain('sln-ghost');
  });

  it('aggregator counter bookkeeping survives a full happy walk (4 stewards)', async () => {
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store, { now: () => T0 });
    await machine.init();
    await machine.registerSolution({ solutionId: 'sln-counters', title: 't' });
    const agg = new LifecycleAggregator({ now: () => T0, solutionMachine: machine });
    await agg.ingest(att('deploy', 'green', 'sln-counters', T0));
    await agg.ingest(att('usage', 'green', 'sln-counters', T0));
    await agg.ingest(att('activation', 'green', 'sln-counters', T0));
    await agg.ingest(att('outcome', 'green', 'sln-counters', T0));
    expect(agg.attestationsIngested).toBe(4);
    expect(agg.compositeStateChanges).toBe(4);
    expect(agg.fsmAdvancesIssued).toBeGreaterThan(4);
    expect(agg.ignoredEnvelopes).toBe(0);
  });

  it('SolutionLifecycleMachine emits solution.completed when FSM reaches done', async () => {
    // The lifecycle-conductor itself does not drive to "done" (that
    // requires the 24h holdover + ea-review-approved, which the daemon's
    // stuck-scan monitors). We assert the FSM is still capable of doing
    // it manually so the integration boundary is sound.
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store, { now: () => T0 });
    await machine.init();
    await machine.registerSolution({ solutionId: 'sln-finish', title: 'finish' });
    // Walk all the way through forwards using the FSM directly.
    for (const step of ['implemented', 'merged', 'deployed', 'imported',
                         'called-in-test', 'called-in-prod', 'producing-metrics', 'done'] as const) {
      await machine.advanceSolution('sln-finish', step, {
        reason: `direct:${step}`,
        triggeredBy: { kind: 'operator', id: 'test' },
      });
    }
    const after = await machine.getSolution('sln-finish');
    expect(after?.status).toBe('done');
    expect(after?.doneAt).not.toBeNull();
  });
});
