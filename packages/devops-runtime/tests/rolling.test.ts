import { describe, expect, it } from 'vitest';
import { runRolling } from '../src/rolling.js';
import {
  badHealthcheck,
  devopsSlice,
  fakeClock,
  okHealthcheck,
  recordingAdapter,
} from './fixtures.js';

describe('runRolling', () => {
  it('runs maxSurge=3 batches by default when nothing specified', async () => {
    const adapter = recordingAdapter();
    const result = await runRolling({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({ deployStrategy: { strategy: 'rolling' } }),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(true);
    expect(result.phases).toHaveLength(3);
    expect(result.phases.map((p) => p.phase)).toEqual([
      'batch-1/3',
      'batch-2/3',
      'batch-3/3',
    ]);
  });

  it('respects maxSurge=5', async () => {
    const adapter = recordingAdapter();
    const result = await runRolling({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({
        deployStrategy: { strategy: 'rolling', maxSurge: 5 },
      }),
      clock: fakeClock(),
    });
    expect(result.phases).toHaveLength(5);
    expect(result.phases.map((p) => p.trafficSharePct)).toEqual([20, 40, 60, 80, 100]);
  });

  it('aborts on first bad healthcheck', async () => {
    const adapter = recordingAdapter({
      'batch-1/3': { ok: true, healthcheck: okHealthcheck() },
      'batch-2/3': { ok: true, healthcheck: badHealthcheck() },
    });
    const result = await runRolling({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({ deployStrategy: { strategy: 'rolling' } }),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(false);
    expect(result.phases).toHaveLength(2);
    expect(result.failedPhaseIndex).toBe(1);
  });

  it('clamps maxSurge to at least 1', async () => {
    const adapter = recordingAdapter();
    const result = await runRolling({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({
        deployStrategy: { strategy: 'rolling', maxSurge: 0 },
      }),
      clock: fakeClock(),
    });
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]?.phase).toBe('batch-1/1');
  });

  it('forwards maxUnavailable to adapter args', async () => {
    const adapter = recordingAdapter();
    await runRolling({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({
        deployStrategy: { strategy: 'rolling', maxSurge: 2, maxUnavailable: 1 },
      }),
      clock: fakeClock(),
    });
    expect(adapter.calls[0]?.input.args?.maxUnavailable).toBe(1);
    expect(adapter.calls[0]?.input.args?.batchCount).toBe(2);
  });
});
