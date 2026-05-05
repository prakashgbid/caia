import { describe, it, expect, vi } from 'vitest';
import { runPollLoop, pollIteration, defaultSleep } from '../src/poll-loop';
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
    // Should have stopped after the abort fired during sleep
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
