import { describe, it, expect, vi } from 'vitest';
import {
  runPollLoop,
  pollIteration,
  defaultSleep,
  computeBackoffMs,
  createFailureTracker,
  updateFailureTracker
} from '../src/poll-loop';
import type { SiteConfig } from '../src/sites-config';
import type { DeployOptions, DeployResult } from '../src/deploy';

const fakeSite = (name: string, port: number): SiteConfig => ({
  name,
  repo: `/tmp/${name}`,
  branch: 'develop',
  port,
  buildCmd: 'echo build',
  startCmd: (p) => `echo start ${p}`,
  healthPath: '/',
  healthMustContain: '<title',
  buildArtifacts: ['dist']
});

const dummyDeployOpts: DeployOptions = {
  installRoot: '/tmp/install',
  buildWorkspaceRoot: '/tmp/buildws'
};

describe('defaultSleep', () => {
  it('sleeps for at least roughly the requested ms', async () => {
    const start = Date.now();
    await defaultSleep(40);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(30);
  });

  it('returns early when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const start = Date.now();
    await defaultSleep(5_000, ctrl.signal);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('returns early on signal abort during sleep', async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 30);
    const start = Date.now();
    await defaultSleep(5_000, ctrl.signal);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('pollIteration', () => {
  it('invokes deployFn for each site', async () => {
    const sites = [fakeSite('a', 1), fakeSite('b', 2)];
    const deployFn = vi.fn(async (s: SiteConfig): Promise<DeployResult> => ({
      status: 'success',
      sha: `sha-${s.name}`,
      durationMs: 5,
      healthCheckMs: 1
    }));
    const result = await pollIteration(new Set(), {
      sites,
      deployOptions: dummyDeployOpts,
      deployFn
    });
    expect(deployFn).toHaveBeenCalledTimes(2);
    expect(result.a).toEqual({ status: 'success', sha: 'sha-a', durationMs: 5, healthCheckMs: 1 });
    expect(result.b).toEqual({ status: 'success', sha: 'sha-b', durationMs: 5, healthCheckMs: 1 });
  });

  it('reports in-progress when site lock is held by previous iteration', async () => {
    const sites = [fakeSite('a', 1)];
    const deployFn = vi.fn(async (): Promise<DeployResult> => ({
      status: 'noop',
      sha: 'x'
    }));
    const inFlight = new Set<string>(['a']);
    const result = await pollIteration(inFlight, {
      sites,
      deployOptions: dummyDeployOpts,
      deployFn
    });
    expect(deployFn).not.toHaveBeenCalled();
    expect(result.a).toEqual({ status: 'in-progress' });
  });

  it('captures errors thrown by deployFn', async () => {
    const sites = [fakeSite('a', 1)];
    const deployFn = vi.fn(async (): Promise<DeployResult> => {
      throw new Error('boom');
    });
    const result = await pollIteration(new Set(), {
      sites,
      deployOptions: dummyDeployOpts,
      deployFn
    });
    expect(result.a).toEqual({ status: 'error', error: 'boom' });
  });

  it('skips sites in cooldown without invoking deployFn', async () => {
    const sites = [fakeSite('a', 1), fakeSite('b', 2)];
    const tracker = createFailureTracker();
    const now = vi.fn().mockReturnValue(1_000_000);
    tracker.cooldownUntil.set('a', 1_000_500); // 500ms remaining
    const deployFn = vi.fn(async (): Promise<DeployResult> => ({
      status: 'success',
      sha: 'x',
      durationMs: 1,
      healthCheckMs: 0
    }));
    const result = await pollIteration(new Set(), {
      sites,
      deployOptions: dummyDeployOpts,
      deployFn,
      failureTracker: tracker,
      now
    });
    expect(deployFn).toHaveBeenCalledTimes(1);
    expect(deployFn.mock.calls[0]![0]!.name).toBe('b');
    expect(result.a).toEqual({ status: 'cooling-down', cooldownRemainingMs: 500 });
    expect(result.b).toEqual({ status: 'success', sha: 'x', durationMs: 1, healthCheckMs: 0 });
  });

  it('runs the site if cooldown has just elapsed', async () => {
    const sites = [fakeSite('a', 1)];
    const tracker = createFailureTracker();
    const now = vi.fn().mockReturnValue(1_000_000);
    tracker.cooldownUntil.set('a', 1_000_000); // exactly elapsed
    const deployFn = vi.fn(async (): Promise<DeployResult> => ({ status: 'noop', sha: 'x' }));
    const result = await pollIteration(new Set(), {
      sites,
      deployOptions: dummyDeployOpts,
      deployFn,
      failureTracker: tracker,
      now
    });
    expect(deployFn).toHaveBeenCalledTimes(1);
    expect(result.a).toEqual({ status: 'noop', sha: 'x' });
  });
});

describe('runPollLoop', () => {
  it('runs N iterations when maxIterations is set', async () => {
    const sites = [fakeSite('a', 1)];
    const deployFn = vi.fn(async (): Promise<DeployResult> => ({
      status: 'noop',
      sha: 'x'
    }));
    const onIteration = vi.fn();
    const sleep = vi.fn(async () => undefined);
    await runPollLoop({
      sites,
      deployOptions: dummyDeployOpts,
      deployFn,
      onIteration,
      sleep,
      intervalMs: 1,
      maxIterations: 3
    });
    expect(onIteration).toHaveBeenCalledTimes(3);
    expect(deployFn).toHaveBeenCalledTimes(3);
  });

  it('stops on abort', async () => {
    const sites = [fakeSite('a', 1)];
    const deployFn = vi.fn(async (): Promise<DeployResult> => ({
      status: 'noop',
      sha: 'x'
    }));
    const ctrl = new AbortController();
    let count = 0;
    const sleep = vi.fn(async () => {
      count++;
      if (count >= 2) ctrl.abort();
    });
    await runPollLoop({
      sites,
      deployOptions: dummyDeployOpts,
      deployFn,
      sleep,
      abortSignal: ctrl.signal,
      intervalMs: 1
    });
    expect(deployFn.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('does not throw when an iteration handler errors', async () => {
    const sites = [fakeSite('a', 1)];
    const deployFn = vi.fn(async (): Promise<DeployResult> => ({
      status: 'noop',
      sha: 'x'
    }));
    const onIteration = vi.fn(() => {
      throw new Error('handler boom');
    });
    const sleep = vi.fn(async () => undefined);
    await expect(
      runPollLoop({
        sites,
        deployOptions: dummyDeployOpts,
        deployFn,
        onIteration,
        sleep,
        intervalMs: 1,
        maxIterations: 1,
        logger: { info: () => undefined, error: () => undefined }
      })
    ).resolves.toBeUndefined();
  });
});

describe('computeBackoffMs', () => {
  it('returns 0 for 0 consecutive failures', () => {
    expect(computeBackoffMs(0)).toBe(0);
  });

  it('returns 0 for negative consecutive failures', () => {
    expect(computeBackoffMs(-1)).toBe(0);
  });

  it('doubles each step under defaults (base=30s)', () => {
    expect(computeBackoffMs(1)).toBe(60_000);
    expect(computeBackoffMs(2)).toBe(120_000);
    expect(computeBackoffMs(3)).toBe(240_000);
    expect(computeBackoffMs(4)).toBe(480_000);
    expect(computeBackoffMs(5)).toBe(960_000);
  });

  it('caps at 30 minutes after enough failures', () => {
    expect(computeBackoffMs(6)).toBe(30 * 60_000); // 2^6 * 30s = 1920s, capped at 1800s
    expect(computeBackoffMs(10)).toBe(30 * 60_000);
    expect(computeBackoffMs(100)).toBe(30 * 60_000);
  });

  it('honours custom baseMs', () => {
    expect(computeBackoffMs(1, { baseMs: 1000 })).toBe(2000);
    expect(computeBackoffMs(2, { baseMs: 1000 })).toBe(4000);
  });

  it('honours custom capMs', () => {
    expect(computeBackoffMs(10, { capMs: 5000 })).toBe(5000);
  });

  it('does not overflow on huge consecutive counts', () => {
    expect(Number.isFinite(computeBackoffMs(1000))).toBe(true);
    expect(computeBackoffMs(1000)).toBe(30 * 60_000);
  });
});

describe('updateFailureTracker', () => {
  it('clears state on success', () => {
    const tracker = createFailureTracker();
    tracker.consecutive.set('a', 3);
    tracker.cooldownUntil.set('a', 12345);
    updateFailureTracker(tracker, 'a', { status: 'success' }, Date.now());
    expect(tracker.consecutive.has('a')).toBe(false);
    expect(tracker.cooldownUntil.has('a')).toBe(false);
  });

  it('clears state on noop', () => {
    const tracker = createFailureTracker();
    tracker.consecutive.set('a', 2);
    tracker.cooldownUntil.set('a', 9999);
    updateFailureTracker(tracker, 'a', { status: 'noop' }, Date.now());
    expect(tracker.consecutive.has('a')).toBe(false);
    expect(tracker.cooldownUntil.has('a')).toBe(false);
  });

  it('increments consecutive on build-failed', () => {
    const tracker = createFailureTracker();
    updateFailureTracker(tracker, 'a', { status: 'build-failed' }, 1000);
    expect(tracker.consecutive.get('a')).toBe(1);
    expect(tracker.cooldownUntil.get('a')).toBe(1000 + 60_000);

    updateFailureTracker(tracker, 'a', { status: 'build-failed' }, 60_500);
    expect(tracker.consecutive.get('a')).toBe(2);
    expect(tracker.cooldownUntil.get('a')).toBe(60_500 + 120_000);
  });

  it('increments on health-check-failed', () => {
    const tracker = createFailureTracker();
    updateFailureTracker(tracker, 'a', { status: 'health-check-failed' }, 1000);
    expect(tracker.consecutive.get('a')).toBe(1);
  });

  it('increments on rollback-failed, disk-full, aborted, error', () => {
    const tracker = createFailureTracker();
    for (const status of ['rollback-failed', 'disk-full', 'aborted', 'error']) {
      updateFailureTracker(tracker, 'a', { status }, 0);
    }
    expect(tracker.consecutive.get('a')).toBe(4);
  });

  it('does NOT count locked as a failure', () => {
    const tracker = createFailureTracker();
    tracker.consecutive.set('a', 2);
    updateFailureTracker(tracker, 'a', { status: 'locked' }, 1000);
    expect(tracker.consecutive.get('a')).toBe(2); // unchanged
  });

  it('does NOT count in-progress as a failure', () => {
    const tracker = createFailureTracker();
    tracker.consecutive.set('a', 1);
    updateFailureTracker(tracker, 'a', { status: 'in-progress' }, 1000);
    expect(tracker.consecutive.get('a')).toBe(1);
  });

  it('does NOT count cooling-down as a failure', () => {
    const tracker = createFailureTracker();
    updateFailureTracker(tracker, 'a', { status: 'cooling-down' }, 1000);
    expect(tracker.consecutive.has('a')).toBe(false);
  });

  it('honours custom backoff options', () => {
    const tracker = createFailureTracker();
    updateFailureTracker(
      tracker,
      'a',
      { status: 'build-failed' },
      1000,
      { baseMs: 1000, capMs: 10_000 }
    );
    expect(tracker.cooldownUntil.get('a')).toBe(1000 + 2000);
  });

  it('tracks each site independently', () => {
    const tracker = createFailureTracker();
    updateFailureTracker(tracker, 'a', { status: 'build-failed' }, 1000);
    updateFailureTracker(tracker, 'b', { status: 'success' }, 1000);
    expect(tracker.consecutive.get('a')).toBe(1);
    expect(tracker.consecutive.has('b')).toBe(false);
  });
});

describe('runPollLoop with backoff (integration)', () => {
  it('skips a site that is in cooldown but still ticks others', async () => {
    const sites = [fakeSite('a', 1), fakeSite('b', 2)];

    let nowVal = 1_000_000;
    const now = (): number => nowVal;
    const tracker = createFailureTracker();

    // Two iterations: a always fails, b always succeeds.
    let iter = 0;
    const deployFn = vi.fn(async (s: SiteConfig): Promise<DeployResult> => {
      iter += 1;
      if (s.name === 'a') {
        return { status: 'build-failed', sha: 'x', error: 'fail' };
      }
      return { status: 'success', sha: `sha-b-${iter}`, durationMs: 1, healthCheckMs: 0 };
    });

    const seen: Array<Record<string, string>> = [];
    const onIteration = (r: Record<string, { status: string }>): void => {
      const summary: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) summary[k] = v.status;
      seen.push(summary);
      // Clock ticks 10s between iterations.
      nowVal += 10_000;
    };

    const sleep = vi.fn(async () => undefined);
    await runPollLoop({
      sites,
      deployOptions: dummyDeployOpts,
      deployFn,
      onIteration,
      sleep,
      intervalMs: 1,
      maxIterations: 4,
      failureTracker: tracker,
      now
    });

    // iter1: both run. a fails (cooldown=60s), b succeeds.
    // iter2 (now=1010s): a's cooldown is until 1060s — still in cooldown. b runs again.
    // iter3 (now=1020s): a still in cooldown. b runs.
    // iter4 (now=1030s): a still in cooldown (until 1060s). b runs.
    expect(seen[0]).toEqual({ a: 'build-failed', b: 'success' });
    expect(seen[1]?.a).toBe('cooling-down');
    expect(seen[1]?.b).toBe('success');
    expect(seen[2]?.a).toBe('cooling-down');
    expect(seen[3]?.a).toBe('cooling-down');

    // Across 4 iterations, a was attempted only once; b was attempted 4 times.
    expect(deployFn).toHaveBeenCalledTimes(5); // 1 (a, iter1) + 4 (b, iter1-4)
  });

  it('resets cooldown after a successful deploy', async () => {
    const sites = [fakeSite('a', 1)];

    let nowVal = 1_000_000;
    const tracker = createFailureTracker();

    let iter = 0;
    const deployFn = vi.fn(async (): Promise<DeployResult> => {
      iter += 1;
      // 1st call fails; 2nd call succeeds.
      if (iter === 1) return { status: 'build-failed', sha: 'x', error: 'fail' };
      return { status: 'success', sha: 'y', durationMs: 1, healthCheckMs: 0 };
    });

    const sleep = vi.fn(async () => undefined);

    // Iter 1 — fail. Iter 2 — skipped (cooldown). Iter 3 — clock advanced past cooldown, retry.
    const advanceClock = (advanceMs: number): void => {
      nowVal += advanceMs;
    };

    await runPollLoop({
      sites,
      deployOptions: dummyDeployOpts,
      deployFn,
      onIteration: () => advanceClock(30_000), // each iteration advances 30s; iter1=run, iter2=cooldown(60s remaining), iter3=clock=cooldownUntil-->run
      sleep,
      intervalMs: 1,
      maxIterations: 3,
      failureTracker: tracker,
      now: () => nowVal
    });

    expect(deployFn).toHaveBeenCalledTimes(2);
    expect(tracker.consecutive.has('a')).toBe(false); // reset on success
    expect(tracker.cooldownUntil.has('a')).toBe(false);
  });
});
