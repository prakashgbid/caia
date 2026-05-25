import { describe, expect, it } from 'vitest';
import { runBlueGreen } from '../src/blue-green.js';
import {
  badHealthcheck,
  devopsSlice,
  fakeClock,
  okHealthcheck,
  recordingAdapter,
  throwingAdapter,
} from './fixtures.js';

describe('runBlueGreen', () => {
  it('happy path: green-up + cutover both succeed', async () => {
    const adapter = recordingAdapter({
      'green-up': { ok: true, healthcheck: okHealthcheck() },
      'cutover': { ok: true, healthcheck: okHealthcheck() },
    });
    const result = await runBlueGreen({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({ deployStrategy: { strategy: 'blue-green' } }),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(true);
    expect(result.phases).toHaveLength(2);
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[0]?.input.phase).toBe('green-up');
    expect(adapter.calls[1]?.input.phase).toBe('cutover');
  });

  it('stops early when green-up fails', async () => {
    const adapter = recordingAdapter({
      'green-up': { ok: false, reason: 'pod failed' },
    });
    const result = await runBlueGreen({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({ deployStrategy: { strategy: 'blue-green' } }),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(false);
    expect(result.phases).toHaveLength(1);
    expect(adapter.calls).toHaveLength(1);
  });

  it('stops on bad healthcheck even when adapter says ok', async () => {
    const adapter = recordingAdapter({
      'green-up': { ok: true, healthcheck: badHealthcheck() },
    });
    const result = await runBlueGreen({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({ deployStrategy: { strategy: 'blue-green' } }),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('healthcheck');
  });

  it('surfaces adapter throws as phase failures', async () => {
    const result = await runBlueGreen({
      adapter: throwingAdapter('boom'),
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({ deployStrategy: { strategy: 'blue-green' } }),
      clock: fakeClock(),
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('boom');
  });

  it('passes healthcheckPath through adapter args', async () => {
    const adapter = recordingAdapter();
    await runBlueGreen({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({
        deployStrategy: { strategy: 'blue-green', healthcheckPath: '/api/ready' },
      }),
      clock: fakeClock(),
    });
    expect(adapter.calls[0]?.input.args?.healthcheckPath).toBe('/api/ready');
  });
});
