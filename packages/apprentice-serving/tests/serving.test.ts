import { describe, expect, it } from 'vitest';
import { ApprenticeServing } from '../src/serving.js';
import {
  AdapterNotFoundError,
  CanaryPercentOutOfRangeError,
  OllamaCreateError,
  RegistryStateMismatchError,
  RollbackTargetInvalidError
} from '../src/types.js';
import {
  createFakeClock,
  createFakeOllamaClient,
  createInMemoryFs,
  fixtureAdapter
} from './helpers/fakes.js';

function setup(opts: { extras?: Record<string, unknown> } = {}) {
  void opts;
  const fs = createInMemoryFs();
  const ollamaClient = createFakeOllamaClient();
  const serving = new ApprenticeServing({
    registryPath: '/tmp/registry.json',
    canaryRoutingConfigPath: '/tmp/canary.json',
    ollamaBinaryPath: 'ollama',
    ollamaClient,
    fs,
    clock: createFakeClock()
  });
  return { fs, ollamaClient, serving };
}

describe('ApprenticeServing — register', () => {
  it('creates a registered entry with metadata sha + history', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/2026-05-06-q' });
    const entry = await serving.register('/adapters/2026-05-06-q');
    expect(entry.adapterName).toBe('2026-05-06-q');
    expect(entry.status).toBe('registered');
    expect(entry.history).toHaveLength(1);
    expect(entry.history[0]!.fromStatus).toBeNull();
    expect(entry.metadataSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is idempotent on re-register', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/x' });
    const a = await serving.register('/adapters/x');
    const b = await serving.register('/adapters/x');
    expect(a.adapterName).toBe(b.adapterName);
    expect(serving.list()).toHaveLength(1);
  });

  it('refreshes evalReport on re-register if eval-report.json appears later', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/y' });
    await serving.register('/adapters/y');
    expect(serving.list()[0]!.evalReport).toBeUndefined();
    fs.put(
      '/adapters/y/eval-report.json',
      JSON.stringify({ adapters: [{ winRate: 0.7, decision: 'promote-canary' }] })
    );
    const updated = await serving.register('/adapters/y');
    expect(updated.evalReport?.winRate).toBe(0.7);
  });
});

describe('ApprenticeServing — promoteToCanary', () => {
  it('loads model into Ollama + transitions registered → canary', async () => {
    const { fs, ollamaClient, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/2026-05-06-q' });
    await serving.register('/adapters/2026-05-06-q');
    const entry = await serving.promoteToCanary('/adapters/2026-05-06-q', 10);
    expect(entry.status).toBe('canary');
    expect(entry.canaryPercent).toBe(10);
    expect(entry.ollamaModelName).toMatch(/^qwen2-5-coder-7b-canary-/);
    expect(ollamaClient.calls.some((c) => c.op === 'create')).toBe(true);
  });

  it('writes canary-routing config', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });
    await serving.register('/adapters/q');
    await serving.promoteToCanary('/adapters/q', 25);
    const written = JSON.parse(fs.readFile('/tmp/canary.json'));
    expect(written.canary.percent).toBe(25);
    expect(written.canary.adapterName).toBe('q');
    expect(written.production).toBeNull();
  });

  it('rejects out-of-range percent', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });
    await serving.register('/adapters/q');
    await expect(serving.promoteToCanary('/adapters/q', 150)).rejects.toThrow(CanaryPercentOutOfRangeError);
  });

  it('archives previous canary when promoting a new one', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/v1', configSha256: 'sha-v1' });
    fixtureAdapter(fs, { adapterPath: '/adapters/v2', configSha256: 'sha-v2' });
    await serving.register('/adapters/v1');
    await serving.register('/adapters/v2');
    await serving.promoteToCanary('/adapters/v1', 10);
    await serving.promoteToCanary('/adapters/v2', 10);
    const v1 = serving.registry.getByName('v1')!;
    const v2 = serving.registry.getByName('v2')!;
    expect(v1.status).toBe('archived');
    expect(v2.status).toBe('canary');
    expect(serving.list().filter((e) => e.status === 'canary')).toHaveLength(1);
  });

  it('auto-registers if adapter is not yet in registry', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/auto' });
    const entry = await serving.promoteToCanary('/adapters/auto', 10);
    expect(entry.status).toBe('canary');
    expect(serving.list()).toHaveLength(1);
  });
});

describe('ApprenticeServing — promoteToProduction', () => {
  it('loads <base>-production model + archives previous production', async () => {
    const { fs, ollamaClient, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/v1', configSha256: 'sha-v1' });
    fixtureAdapter(fs, { adapterPath: '/adapters/v2', configSha256: 'sha-v2' });
    await serving.register('/adapters/v1');
    await serving.promoteToCanary('/adapters/v1', 100);
    await serving.promoteToProduction('/adapters/v1');
    expect(ollamaClient.models.has('qwen2-5-coder-7b-production')).toBe(true);
    await serving.register('/adapters/v2');
    await serving.promoteToCanary('/adapters/v2', 100);
    await serving.promoteToProduction('/adapters/v2');
    const v1 = serving.registry.getByName('v1')!;
    const v2 = serving.registry.getByName('v2')!;
    expect(v1.status).toBe('archived');
    expect(v2.status).toBe('production');
  });

  it('writes canary-routing config with production set, canary cleared', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });
    await serving.promoteToCanary('/adapters/q', 100);
    await serving.promoteToProduction('/adapters/q');
    const written = JSON.parse(fs.readFile('/tmp/canary.json'));
    expect(written.production.adapterName).toBe('q');
    expect(written.canary).toBeNull();
  });

  it('throws if adapter is in registered (skipping canary not allowed)', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });
    await serving.register('/adapters/q');
    await expect(serving.promoteToProduction('/adapters/q')).rejects.toThrow(RegistryStateMismatchError);
  });
});

describe('ApprenticeServing — rollback', () => {
  it('re-promotes an archived adapter to production', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/v1', configSha256: 's1' });
    fixtureAdapter(fs, { adapterPath: '/adapters/v2', configSha256: 's2' });
    await serving.promoteToCanary('/adapters/v1', 100);
    await serving.promoteToProduction('/adapters/v1');
    await serving.promoteToCanary('/adapters/v2', 100);
    await serving.promoteToProduction('/adapters/v2');
    // v1 is now archived. Rollback to v1.
    const restored = await serving.rollback('/adapters/v1');
    expect(restored.status).toBe('production');
    expect(restored.adapterName).toBe('v1');
    const v2 = serving.registry.getByName('v2')!;
    expect(v2.status).toBe('archived');
  });

  it('throws RollbackTargetInvalidError when target is currently production', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });
    await serving.promoteToCanary('/adapters/q', 100);
    await serving.promoteToProduction('/adapters/q');
    await expect(serving.rollback('/adapters/q')).rejects.toThrow(RollbackTargetInvalidError);
  });

  it('throws AdapterNotFoundError when target not in registry', async () => {
    const { serving } = setup();
    await expect(serving.rollback('/nonexistent/adapter')).rejects.toThrow(AdapterNotFoundError);
  });
});

describe('ApprenticeServing — reject', () => {
  it('marks adapter rejected with reason', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });
    await serving.register('/adapters/q');
    const e = await serving.reject('/adapters/q', 'eval win-rate too low');
    expect(e.status).toBe('rejected');
    expect(e.rejectionReason).toBe('eval win-rate too low');
  });

  it('removes adapter from Ollama if loaded', async () => {
    const { fs, ollamaClient, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });
    await serving.promoteToCanary('/adapters/q', 10);
    await serving.reject('/adapters/q', 'changed mind');
    const removeCalls = ollamaClient.calls.filter((c) => c.op === 'remove');
    expect(removeCalls.length).toBeGreaterThan(0);
  });

  it('rejects empty reason', async () => {
    const { fs, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });
    await serving.register('/adapters/q');
    await expect(serving.reject('/adapters/q', '')).rejects.toThrow(RegistryStateMismatchError);
  });
});

describe('ApprenticeServing — failure handling', () => {
  it('surfaces OllamaCreateError without mutating registry status', async () => {
    const { fs, ollamaClient, serving } = setup();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });
    await serving.register('/adapters/q');
    ollamaClient.failNextCreate = new OllamaCreateError('simulated failure');
    await expect(serving.promoteToCanary('/adapters/q', 10)).rejects.toThrow(OllamaCreateError);
    const e = serving.registry.getByName('q')!;
    expect(e.status).toBe('registered'); // unchanged after failure
  });
});

describe('ApprenticeServing — GC archived', () => {
  it('drops oldest archived entries beyond maxArchivedToKeep', async () => {
    const fs = createInMemoryFs();
    const serving = new ApprenticeServing({
      registryPath: '/tmp/r.json',
      canaryRoutingConfigPath: '/tmp/c.json',
      ollamaBinaryPath: 'ollama',
      ollamaClient: createFakeOllamaClient(),
      fs,
      clock: createFakeClock(),
      maxArchivedToKeep: 2
    });
    for (let i = 1; i <= 5; i++) {
      const p = `/adapters/v${i}`;
      fixtureAdapter(fs, { adapterPath: p, configSha256: `s${i}` });
      await serving.promoteToCanary(p, 100);
      await serving.promoteToProduction(p);
    }
    // After the 5th promotion: 4 archived + 1 production. With maxArchivedToKeep=2,
    // 2 oldest archived should be dropped, leaving 2 archived + 1 production = 3 entries.
    const all = serving.list();
    expect(all.filter((e) => e.status === 'archived')).toHaveLength(2);
    expect(all.filter((e) => e.status === 'production')).toHaveLength(1);
  });
});
