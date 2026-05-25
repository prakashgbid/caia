import { describe, expect, it } from 'vitest';
import { runCanary } from '../src/canary.js';
import {
  badHealthcheck,
  devopsSlice,
  fakeClock,
  okHealthcheck,
  recordingAdapter,
  throwingAdapter,
} from './fixtures.js';

describe('runCanary', () => {
  it('happy path: walks default schedule 10/50/100', async () => {
    const adapter = recordingAdapter({});
    const result = await runCanary({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice(),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(true);
    expect(result.phases).toHaveLength(3);
    expect(result.phases.map((p) => p.trafficSharePct)).toEqual([10, 50, 100]);
  });

  it('respects a custom trafficShiftSchedule', async () => {
    const adapter = recordingAdapter({});
    const result = await runCanary({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({
        deployStrategy: { strategy: 'canary', trafficShiftSchedule: [5, 25, 75, 100] },
      }),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(true);
    expect(result.phases.map((p) => p.trafficSharePct)).toEqual([5, 25, 75, 100]);
  });

  it('aborts at 50% when healthcheck goes red', async () => {
    const adapter = recordingAdapter({
      'canary-10': { ok: true, healthcheck: okHealthcheck() },
      'canary-50': { ok: true, healthcheck: badHealthcheck() },
    });
    const result = await runCanary({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice(),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(false);
    expect(result.phases).toHaveLength(2);
    expect(result.failureReason).toContain('canary 50%');
    expect(result.failedPhaseIndex).toBe(1);
    expect(adapter.calls).toHaveLength(2);
  });

  it('aborts at first step when adapter returns ok=false', async () => {
    const adapter = recordingAdapter({
      'canary-10': { ok: false, reason: 'config invalid' },
    });
    const result = await runCanary({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice(),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(false);
    expect(result.phases).toHaveLength(1);
    expect(result.failureReason).toContain('config invalid');
  });

  it('surfaces adapter throws as phase failures', async () => {
    const result = await runCanary({
      adapter: throwingAdapter('kaboom'),
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice(),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('kaboom');
  });

  it('forwards dwellMin to the adapter', async () => {
    const adapter = recordingAdapter();
    await runCanary({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({
        deployStrategy: { strategy: 'canary', dwellMin: 15 },
      }),
      clock: fakeClock(),
    });
    expect(adapter.calls[0]?.input.args?.dwellMin).toBe(15);
  });
});
