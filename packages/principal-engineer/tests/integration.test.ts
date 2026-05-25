import { describe, expect, it } from 'vitest';

import { schedule } from '../src/scheduler.js';
import { FakeStateMachine, mk, okSpawn, staticSystemPrompt } from './test-helpers.js';

describe('schedule() — 50-ticket integration', () => {
  it('produces a realistic wave plan with mixed dependencies and dispatches every ticket', async () => {
    // 5 chains of 10 tickets each (sequential within each chain).
    // 3 diamonds at the end of the first 3 chains.
    // 2 resource-lock conflicts inside chain[0] level-5.
    const tickets = [];
    const projectIdByTicket: Record<string, string> = {};

    for (let chain = 0; chain < 5; chain++) {
      for (let pos = 0; pos < 10; pos++) {
        const id = `c${chain}-t${pos}`;
        const deps = pos === 0 ? [] : [`c${chain}-t${pos - 1}`];
        const extras: { resourceLocks?: readonly string[] } = {};
        if (chain === 0 && pos === 5) extras.resourceLocks = ['db-write'];
        if (chain === 0 && pos === 6) extras.resourceLocks = ['db-write'];
        tickets.push(mk(id, deps, extras));
        projectIdByTicket[id] = `proj-${chain}`;
      }
    }

    // 3 diamond add-ons: a "join" node on top of two ends.
    for (let i = 0; i < 3; i++) {
      const id = `diamond-${i}`;
      tickets.push(mk(id, [`c${i}-t9`, `c${(i + 1) % 5}-t9`]));
      projectIdByTicket[id] = `proj-diamond-${i}`;
    }

    const sm = new FakeStateMachine();
    for (const pid of Object.values(projectIdByTicket)) {
      sm.ensureProject(pid, 'tests-reviewed');
    }

    const result = await schedule(
      {
        tickets,
        projectIdByTicket,
        tenantTier: 'enterprise',
      },
      {
        stateMachine: sm,
        spawnFn: okSpawn(),
        fseSubagentPath: 'fake.md',
        workerIds: ['w1', 'w2', 'w3'],
        dryRun: true,
      },
    );

    expect(tickets.length).toBe(53);
    expect(result.cycles).toEqual([]);
    expect(result.wavePlan.waveCount).toBeGreaterThanOrEqual(11);
    expect(result.dispatched).toHaveLength(53);
    expect(result.dispatched.every((d) => d.ok)).toBe(true);
    expect(result.failures).toEqual([]);

    // Every ticket got at least one transition to 'scheduled'.
    const scheduled = result.transitions.filter((t) => t.toState === 'scheduled');
    expect(scheduled.length).toBe(53);
  });

  it('surfaces cycles via ScheduleResult.cycles and skips dispatch', async () => {
    const sm = new FakeStateMachine();
    sm.ensureProject('p1', 'tests-reviewed');
    sm.ensureProject('p2', 'tests-reviewed');
    const result = await schedule(
      {
        tickets: [mk('A', ['B']), mk('B', ['A'])],
        projectIdByTicket: { A: 'p1', B: 'p2' },
        tenantTier: 'pro',
      },
      {
        stateMachine: sm,
        spawnFn: okSpawn(),
        fseSubagentPath: 'fake.md',
        workerIds: ['w1'],
        dryRun: true,
      },
    );
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]?.nodes).toEqual(['A', 'B']);
    expect(result.dispatched).toEqual([]);
    // Both projects driven to scheduling-failed.
    expect(result.transitions.every((t) => t.toState === 'scheduling-failed')).toBe(true);
  });
});
