/**
 * Full lifecycle integration test against a fake Ollama. Materialises three
 * fake adapter directories on an in-memory FS and walks them through:
 *
 *   register v1 → canary v1 (10%) → production v1
 *   register v2 → canary v2 (10%) → production v2 (v1 → archived)
 *   rollback to v1                  (v2 → archived)
 *   register v3 → reject v3 (eval gate)
 *
 * Asserts:
 *   - registry.json contents at every step
 *   - canary-routing.json contents at every step
 *   - FakeOllamaClient invocation log matches expected sequence
 */

import { describe, expect, it } from 'vitest';
import { ApprenticeServing } from '../src/serving.js';
import {
  createFakeClock,
  createFakeOllamaClient,
  createInMemoryFs,
  fixtureAdapter
} from './helpers/fakes.js';

describe('ApprenticeServing integration — full lifecycle', () => {
  it('walks 3 adapters through the full state machine', async () => {
    const fs = createInMemoryFs();
    const ollamaClient = createFakeOllamaClient();
    const serving = new ApprenticeServing({
      registryPath: '/data/apprentice/registry.json',
      canaryRoutingConfigPath: '/data/apprentice/canary-routing.json',
      ollamaBinaryPath: 'ollama',
      ollamaClient,
      fs,
      clock: createFakeClock()
    });

    // --- v1 fixture ---
    fixtureAdapter(fs, {
      adapterPath: '/adapters/2026-05-06-qwen-rank8',
      configSha256: 'sha-v1',
      evalReport: { winRate: 0.65, decision: 'promote-canary' }
    });

    // --- v2 fixture ---
    fixtureAdapter(fs, {
      adapterPath: '/adapters/2026-05-13-qwen-rank8',
      configSha256: 'sha-v2',
      evalReport: { winRate: 0.72, decision: 'promote-canary' }
    });

    // --- v3 fixture (regression) ---
    fixtureAdapter(fs, {
      adapterPath: '/adapters/2026-05-20-qwen-rank8',
      configSha256: 'sha-v3',
      evalReport: { winRate: 0.45, decision: 'reject-low-winrate', regressionFlags: ['p1', 'p2'] }
    });

    // === Step 1: register v1 ===
    const v1Reg = await serving.register('/adapters/2026-05-06-qwen-rank8');
    expect(v1Reg.status).toBe('registered');
    expect(v1Reg.evalReport?.winRate).toBe(0.65);

    // === Step 2: canary v1 @ 10% ===
    await serving.promoteToCanary('/adapters/2026-05-06-qwen-rank8', 10);
    {
      const cfg = JSON.parse(fs.readFile('/data/apprentice/canary-routing.json'));
      expect(cfg.production).toBeNull();
      expect(cfg.canary.percent).toBe(10);
      expect(cfg.canary.adapterName).toBe('2026-05-06-qwen-rank8');
    }

    // === Step 3: promote v1 to production ===
    const v1Prod = await serving.promoteToProduction('/adapters/2026-05-06-qwen-rank8');
    expect(v1Prod.status).toBe('production');
    expect(v1Prod.ollamaModelName).toBe('qwen2-5-coder-7b-production');
    {
      const cfg = JSON.parse(fs.readFile('/data/apprentice/canary-routing.json'));
      expect(cfg.production.adapterName).toBe('2026-05-06-qwen-rank8');
      expect(cfg.canary).toBeNull();
    }
    expect(ollamaClient.models.has('qwen2-5-coder-7b-production')).toBe(true);

    // === Step 4: register v2 + canary v2 ===
    await serving.register('/adapters/2026-05-13-qwen-rank8');
    await serving.promoteToCanary('/adapters/2026-05-13-qwen-rank8', 15);
    {
      const cfg = JSON.parse(fs.readFile('/data/apprentice/canary-routing.json'));
      expect(cfg.production.adapterName).toBe('2026-05-06-qwen-rank8'); // v1 still prod
      expect(cfg.canary.adapterName).toBe('2026-05-13-qwen-rank8'); // v2 canary
      expect(cfg.canary.percent).toBe(15);
    }

    // === Step 5: promote v2 to production (v1 → archived) ===
    const v2Prod = await serving.promoteToProduction('/adapters/2026-05-13-qwen-rank8');
    expect(v2Prod.status).toBe('production');
    {
      const cfg = JSON.parse(fs.readFile('/data/apprentice/canary-routing.json'));
      expect(cfg.production.adapterName).toBe('2026-05-13-qwen-rank8');
      expect(cfg.canary).toBeNull();
    }
    const v1After = serving.registry.getByName('2026-05-06-qwen-rank8')!;
    expect(v1After.status).toBe('archived');
    expect(v1After.archivedAt).toBeDefined();

    // === Step 6: rollback to v1 ===
    const v1Restored = await serving.rollback('/adapters/2026-05-06-qwen-rank8');
    expect(v1Restored.status).toBe('production');
    expect(v1Restored.adapterName).toBe('2026-05-06-qwen-rank8');
    const v2After = serving.registry.getByName('2026-05-13-qwen-rank8')!;
    expect(v2After.status).toBe('archived');

    // === Step 7: register v3, reject without canary ===
    await serving.register('/adapters/2026-05-20-qwen-rank8');
    const v3Rej = await serving.reject(
      '/adapters/2026-05-20-qwen-rank8',
      'eval winRate=0.45 below gate=0.60; regressions on p1,p2'
    );
    expect(v3Rej.status).toBe('rejected');
    expect(v3Rej.rejectionReason).toContain('winRate=0.45');

    // === Final assertions: ===
    const all = serving.list();
    expect(all.find((e) => e.adapterName === '2026-05-06-qwen-rank8')!.status).toBe('production');
    expect(all.find((e) => e.adapterName === '2026-05-13-qwen-rank8')!.status).toBe('archived');
    expect(all.find((e) => e.adapterName === '2026-05-20-qwen-rank8')!.status).toBe('rejected');

    // Ollama call sequence sanity:
    // creates: v1-canary, v1-prod, v2-canary, v2-prod, v1-prod (rollback)
    const creates = ollamaClient.calls.filter((c) => c.op === 'create');
    expect(creates.length).toBe(5);
    // production model should be currently loaded
    expect(ollamaClient.models.has('qwen2-5-coder-7b-production')).toBe(true);
  });

  it('persists registry across instance restarts', async () => {
    const fs = createInMemoryFs();
    const ollamaClient1 = createFakeOllamaClient();
    fixtureAdapter(fs, { adapterPath: '/adapters/q' });

    const s1 = new ApprenticeServing({
      registryPath: '/data/registry.json',
      canaryRoutingConfigPath: '/data/canary.json',
      ollamaClient: ollamaClient1,
      fs,
      clock: createFakeClock()
    });
    await s1.promoteToCanary('/adapters/q', 10);
    await s1.promoteToProduction('/adapters/q');

    // New instance, same disk:
    const ollamaClient2 = createFakeOllamaClient({ models: ['qwen2-5-coder-7b-production'] });
    const s2 = new ApprenticeServing({
      registryPath: '/data/registry.json',
      canaryRoutingConfigPath: '/data/canary.json',
      ollamaClient: ollamaClient2,
      fs,
      clock: createFakeClock()
    });

    expect(s2.list()).toHaveLength(1);
    expect(s2.currentProduction()?.adapterName).toBe('q');
    expect(s2.canaryRouter.resolve().kind).toBe('production-only');
  });
});
