import { describe, expect, it } from 'vitest';

import { LifecycleAggregator } from '../src/aggregator.js';
import { LifecycleConductorApi } from '../src/api.js';
import type { LifecycleHistoryReader } from '../src/api.js';
import type { StewardAttestation, StewardName } from '../src/types.js';

const T0 = new Date('2026-05-25T12:00:00Z');

function att(
  steward: StewardName,
  status: 'green' | 'amber' | 'red',
  solutionId = 'sln-A',
  observedAt: Date = T0,
): StewardAttestation {
  return { steward, status, solutionId, observedAt: observedAt.toISOString() };
}

function makeReader(): LifecycleHistoryReader {
  return {
    async getSolutionLifecycle(solutionId: string) {
      if (solutionId === 'sln-only-in-fsm') {
        return {
          solution: {
            solutionId,
            title: 'FSM-only',
            status: 'approved',
            statusSince: T0,
            createdAt: T0,
            doneAt: null,
            abandonedAt: null,
          },
          history: [
            {
              id: 1,
              fromState: null,
              toState: 'approved',
              reason: 'registerSolution',
              actorId: 'ea-architect-agent',
              at: T0,
            },
          ],
          ageHoursInState: 0,
        };
      }
      if (solutionId === 'sln-A') {
        return {
          solution: {
            solutionId,
            title: 'Test solution',
            status: 'deployed',
            statusSince: T0,
            createdAt: T0,
            doneAt: null,
            abandonedAt: null,
          },
          history: [
            { id: 1, fromState: null, toState: 'approved', reason: 'registerSolution', actorId: 'ea-architect-agent', at: T0 },
            { id: 2, fromState: 'approved', toState: 'deployed', reason: 'forward-step', actorId: 'deploy-steward', at: T0 },
          ],
          ageHoursInState: 0,
        };
      }
      throw new Error('not-found');
    },
    async listActiveSolutions() {
      return [
        { solutionId: 'sln-A', status: 'deployed', title: 'Test solution' },
        { solutionId: 'sln-only-in-fsm', status: 'approved', title: 'FSM-only' },
      ];
    },
  };
}

describe('LifecycleConductorApi.getSolutionLifecycle', () => {
  it('returns null for an unknown solution with no reader', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    const api = new LifecycleConductorApi(agg);
    expect(await api.getSolutionLifecycle('does-not-exist')).toBeNull();
  });

  it('returns FSM-only view when the aggregator has no snapshot', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    const api = new LifecycleConductorApi(agg, makeReader());
    const view = await api.getSolutionLifecycle('sln-only-in-fsm');
    expect(view).not.toBeNull();
    expect(view?.fsmState).toBe('approved');
    expect(view?.title).toBe('FSM-only');
    expect(view?.compositeState).toBe('plan-approved');
    expect(view?.history).toHaveLength(1);
  });

  it('returns combined view when aggregator and FSM both have data', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green'));
    const api = new LifecycleConductorApi(agg, makeReader());
    const view = await api.getSolutionLifecycle('sln-A');
    expect(view).not.toBeNull();
    expect(view?.compositeState).toBe('deployed');
    expect(view?.fsmState).toBe('deployed');
    expect(view?.history.length).toBeGreaterThan(0);
    expect(view?.history[0]?.toState).toBe('deployed');
  });

  it('survives if FSM reader throws (composite-only view)', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green'));
    const flakyReader: LifecycleHistoryReader = {
      async getSolutionLifecycle(): Promise<never> {
        throw new Error('db unavailable');
      },
    };
    const api = new LifecycleConductorApi(agg, flakyReader);
    const view = await api.getSolutionLifecycle('sln-A');
    expect(view?.compositeState).toBe('deployed');
    expect(view?.fsmState).toBeNull();
  });
});

describe('LifecycleConductorApi.listIncompleteSolutions', () => {
  it('returns empty when no solutions exist', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    const api = new LifecycleConductorApi(agg);
    expect(await api.listIncompleteSolutions()).toEqual([]);
  });

  it('lists aggregator-known incomplete solutions', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green', 'sln-A'));
    await agg.ingest(att('deploy', 'red', 'sln-B'));
    const api = new LifecycleConductorApi(agg);
    const list = await api.listIncompleteSolutions();
    const states = list.map((l) => `${l.solutionId}:${l.compositeState}`);
    expect(states[0]).toBe('sln-B:degraded');
    expect(states).toContain('sln-A:deployed');
  });

  it('augments with FSM-tracked solutions never observed by aggregator', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    const api = new LifecycleConductorApi(agg, makeReader());
    const list = await api.listIncompleteSolutions();
    expect(list.map((l) => l.solutionId)).toContain('sln-only-in-fsm');
  });

  it('sorts degraded before forward states', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green', 'sln-A'));
    await agg.ingest(att('deploy', 'red', 'sln-B'));
    await agg.ingest(att('deploy', 'green', 'sln-C'));
    await agg.ingest(att('usage', 'green', 'sln-C'));
    const api = new LifecycleConductorApi(agg);
    const list = await api.listIncompleteSolutions();
    expect(list[0]?.compositeState).toBe('degraded');
  });
});

describe('LifecycleConductorApi.getDodStatus', () => {
  it('passes through to the aggregator', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green'));
    const api = new LifecycleConductorApi(agg);
    const dod = api.getDodStatus('sln-A');
    expect(dod?.done).toBe(false);
    expect(dod?.compositeState).toBe('deployed');
  });

  it('returns null for unknown solutions', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    const api = new LifecycleConductorApi(agg);
    expect(api.getDodStatus('nope')).toBeNull();
  });
});
