/**
 * Worker entry point — CODING-001 smoke tests.
 *
 * Validates the env reader + bootstrap entry. Subsequent PRs add
 * tests for register, heartbeat, assignment IPC.
 */

import { readEnv, bootstrap } from '../src/main';

describe('readEnv', () => {
  it('throws when ORCHESTRATOR_URL is missing', () => {
    expect(() => readEnv({})).toThrow(/ORCHESTRATOR_URL/);
  });

  it('parses defaults for poll + heartbeat intervals', () => {
    const env = readEnv({ ORCHESTRATOR_URL: 'http://x' });
    expect(env.orchestratorUrl).toBe('http://x');
    expect(env.workerKind).toBe('coding');
    expect(env.pollIntervalMs).toBe(5000);
    expect(env.heartbeatIntervalMs).toBe(15000);
  });

  it('honours overrides', () => {
    const env = readEnv({
      ORCHESTRATOR_URL: 'http://x',
      POLL_INTERVAL_MS: '1000',
      HEARTBEAT_INTERVAL_MS: '7500',
    });
    expect(env.pollIntervalMs).toBe(1000);
    expect(env.heartbeatIntervalMs).toBe(7500);
  });
});

describe('bootstrap', () => {
  it('returns a reader + shutdown handle', async () => {
    const handle = await bootstrap({
      orchestratorUrl: 'http://x',
      workerKind: 'coding',
      pollIntervalMs: 100,
      heartbeatIntervalMs: 100,
    });
    expect(handle.reader).toBeTruthy();
    expect(typeof handle.shutdown).toBe('function');
    await handle.shutdown();
  });
});
