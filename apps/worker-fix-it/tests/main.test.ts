/**
 * Worker entry point — FIX-001 smoke tests.
 *
 * Validates the env reader + bootstrap entry. Subsequent FIX-### PRs
 * add tests for register, heartbeat, and event subscription.
 */

import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_ATTEMPTS_PER_CASE,
  DEFAULT_POLL_INTERVAL_MS,
  bootstrap,
  readEnv,
} from '../src/main';

describe('readEnv', () => {
  it('throws when ORCHESTRATOR_URL is missing', () => {
    expect(() => readEnv({})).toThrow(/ORCHESTRATOR_URL/);
  });

  it('parses defaults for poll + heartbeat + max attempts', () => {
    const env = readEnv({ ORCHESTRATOR_URL: 'http://x' });
    expect(env.orchestratorUrl).toBe('http://x');
    expect(env.workerKind).toBe('fix-it');
    expect(env.pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_MS);
    expect(env.heartbeatIntervalMs).toBe(DEFAULT_HEARTBEAT_INTERVAL_MS);
    expect(env.maxAttemptsPerCase).toBe(DEFAULT_MAX_ATTEMPTS_PER_CASE);
  });

  it('honours overrides', () => {
    const env = readEnv({
      ORCHESTRATOR_URL: 'http://x',
      POLL_INTERVAL_MS: '1000',
      HEARTBEAT_INTERVAL_MS: '7500',
      MAX_ATTEMPTS_PER_CASE: '3',
    });
    expect(env.pollIntervalMs).toBe(1000);
    expect(env.heartbeatIntervalMs).toBe(7500);
    expect(env.maxAttemptsPerCase).toBe(3);
  });

  it('rejects a wrong WORKER_KIND', () => {
    expect(() =>
      readEnv({ ORCHESTRATOR_URL: 'http://x', WORKER_KIND: 'coding' }),
    ).toThrow(/WORKER_KIND/);
  });

  it('rejects MAX_ATTEMPTS_PER_CASE that is non-positive or non-numeric', () => {
    expect(() =>
      readEnv({ ORCHESTRATOR_URL: 'http://x', MAX_ATTEMPTS_PER_CASE: '0' }),
    ).toThrow(/MAX_ATTEMPTS_PER_CASE/);
    expect(() =>
      readEnv({ ORCHESTRATOR_URL: 'http://x', MAX_ATTEMPTS_PER_CASE: 'abc' }),
    ).toThrow(/MAX_ATTEMPTS_PER_CASE/);
  });
});

describe('bootstrap', () => {
  it('returns an orchestrator + shutdown handle', async () => {
    const handle = await bootstrap({
      orchestratorUrl: 'http://x',
      workerKind: 'fix-it',
      pollIntervalMs: 100,
      heartbeatIntervalMs: 100,
      maxAttemptsPerCase: 6,
    });
    expect(handle.orchestrator).toBeTruthy();
    expect(typeof handle.shutdown).toBe('function');
    await handle.shutdown();
  });

  it('produces a fresh FixItOrchestrator per call', async () => {
    const a = await bootstrap({
      orchestratorUrl: 'http://x',
      workerKind: 'fix-it',
      pollIntervalMs: 100,
      heartbeatIntervalMs: 100,
      maxAttemptsPerCase: 6,
    });
    const b = await bootstrap({
      orchestratorUrl: 'http://x',
      workerKind: 'fix-it',
      pollIntervalMs: 100,
      heartbeatIntervalMs: 100,
      maxAttemptsPerCase: 6,
    });
    expect(a.orchestrator).not.toBe(b.orchestrator);
    await a.shutdown();
    await b.shutdown();
  });

  it('shutdown is idempotent', async () => {
    const handle = await bootstrap({
      orchestratorUrl: 'http://x',
      workerKind: 'fix-it',
      pollIntervalMs: 100,
      heartbeatIntervalMs: 100,
      maxAttemptsPerCase: 6,
    });
    await handle.shutdown();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
