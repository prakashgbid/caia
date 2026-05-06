import { describe, expect, it } from 'vitest';
import { CanaryRouter, canaryBucket, writeCanaryRouting } from '../src/canary-router.js';
import { createFakeClock, createInMemoryFs } from './helpers/fakes.js';

describe('CanaryRouter — read/write', () => {
  it('returns no-production when config file is absent', () => {
    const fs = createInMemoryFs();
    const r = new CanaryRouter({ canaryRoutingConfigPath: '/tmp/canary.json', fs, clock: createFakeClock() });
    expect(r.resolve().kind).toBe('no-production');
    expect(r.routeRequest('any')).toBeNull();
  });

  it('writes + reads back production-only config', () => {
    const fs = createInMemoryFs();
    const r = new CanaryRouter({ canaryRoutingConfigPath: '/tmp/canary.json', fs, clock: createFakeClock() });
    r.write({
      production: { ollamaModelName: 'qwen-prod', adapterName: 'a1' },
      canary: null
    });
    const decision = r.resolve();
    expect(decision.kind).toBe('production-only');
    if (decision.kind === 'production-only') {
      expect(decision.production.ollamaModelName).toBe('qwen-prod');
    }
    expect(r.routeRequest('any')).toBe('qwen-prod');
  });

  it('writes + reads back production-with-canary config', () => {
    const fs = createInMemoryFs();
    const r = new CanaryRouter({ canaryRoutingConfigPath: '/tmp/canary.json', fs, clock: createFakeClock() });
    r.write({
      production: { ollamaModelName: 'qwen-prod', adapterName: 'a1' },
      canary: { ollamaModelName: 'qwen-canary-abc', adapterName: 'a2', percent: 10 }
    });
    const decision = r.resolve();
    expect(decision.kind).toBe('production-with-canary');
  });

  it('clears canary back to null on subsequent write', () => {
    const fs = createInMemoryFs();
    const r = new CanaryRouter({ canaryRoutingConfigPath: '/tmp/canary.json', fs, clock: createFakeClock() });
    r.write({
      production: { ollamaModelName: 'qwen-prod', adapterName: 'a1' },
      canary: { ollamaModelName: 'c', adapterName: 'a2', percent: 10 }
    });
    r.write({
      production: { ollamaModelName: 'qwen-prod', adapterName: 'a1' },
      canary: null
    });
    expect(r.resolve().kind).toBe('production-only');
  });
});

describe('CanaryRouter — deterministic routing', () => {
  it('same requestId always routes to the same model', () => {
    const fs = createInMemoryFs();
    const r = new CanaryRouter({ canaryRoutingConfigPath: '/tmp/canary.json', fs, clock: createFakeClock() });
    r.write({
      production: { ollamaModelName: 'prod', adapterName: 'a1' },
      canary: { ollamaModelName: 'canary', adapterName: 'a2', percent: 50 }
    });
    const a = r.routeRequest('request-id-42');
    const b = r.routeRequest('request-id-42');
    expect(a).toBe(b);
  });

  it('percent=0 routes everything to production', () => {
    const fs = createInMemoryFs();
    const r = new CanaryRouter({ canaryRoutingConfigPath: '/tmp/canary.json', fs, clock: createFakeClock() });
    r.write({
      production: { ollamaModelName: 'prod', adapterName: 'a1' },
      canary: { ollamaModelName: 'canary', adapterName: 'a2', percent: 0 }
    });
    for (let i = 0; i < 100; i++) {
      expect(r.routeRequest(`req-${i}`)).toBe('prod');
    }
  });

  it('percent=100 routes everything to canary', () => {
    const fs = createInMemoryFs();
    const r = new CanaryRouter({ canaryRoutingConfigPath: '/tmp/canary.json', fs, clock: createFakeClock() });
    r.write({
      production: { ollamaModelName: 'prod', adapterName: 'a1' },
      canary: { ollamaModelName: 'canary', adapterName: 'a2', percent: 100 }
    });
    for (let i = 0; i < 100; i++) {
      expect(r.routeRequest(`req-${i}`)).toBe('canary');
    }
  });

  it('percent=10 routes ~10% to canary across many requests', () => {
    const fs = createInMemoryFs();
    const r = new CanaryRouter({ canaryRoutingConfigPath: '/tmp/canary.json', fs, clock: createFakeClock() });
    r.write({
      production: { ollamaModelName: 'prod', adapterName: 'a1' },
      canary: { ollamaModelName: 'canary', adapterName: 'a2', percent: 10 }
    });
    let canaryHits = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      if (r.routeRequest(`req-${i}`) === 'canary') canaryHits++;
    }
    // canaryBucket is uniform sha256 mod 100; expect ~10% with reasonable variance.
    expect(canaryHits).toBeGreaterThan(60);
    expect(canaryHits).toBeLessThan(140);
  });
});

describe('canaryBucket', () => {
  it('returns a value in [0, 99]', () => {
    for (let i = 0; i < 50; i++) {
      const b = canaryBucket(`req-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('is deterministic over identical input', () => {
    expect(canaryBucket('foo')).toBe(canaryBucket('foo'));
  });
});

describe('writeCanaryRouting helper', () => {
  it('writes via tmp + rename', () => {
    const fs = createInMemoryFs();
    writeCanaryRouting(
      fs,
      '/tmp/c.json',
      {
        production: { ollamaModelName: 'p', adapterName: 'a' },
        canary: null
      },
      '2026-05-06T00:00:00.000Z'
    );
    expect(fs.exists('/tmp/c.json')).toBe(true);
    const parsed = JSON.parse(fs.readFile('/tmp/c.json'));
    expect(parsed.production.ollamaModelName).toBe('p');
    expect(parsed.canary).toBeNull();
  });
});
