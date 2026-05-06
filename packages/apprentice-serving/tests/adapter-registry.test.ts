import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../src/adapter-registry.js';
import {
  CanaryPercentOutOfRangeError,
  RegistryCorruptError,
  RegistryInvariantError,
  RegistryStateMismatchError,
  RollbackTargetInvalidError
} from '../src/types.js';
import type { RegistryEntry } from '../src/types.js';
import { createFakeClock, createInMemoryFs } from './helpers/fakes.js';

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  const base: RegistryEntry = {
    adapterName: '2026-05-06-qwen',
    adapterPath: '/tmp/adapters/2026-05-06-qwen',
    metadataSha256: 'a'.repeat(64),
    configSha256: 'cfg-sha',
    baseModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
    baseModelOllamaTag: 'qwen2.5-coder:7b',
    status: 'registered',
    history: [
      { at: '2026-05-06T12:00:00.000Z', fromStatus: null, toStatus: 'registered' }
    ],
    registeredAt: '2026-05-06T12:00:00.000Z'
  };
  return { ...base, ...overrides };
}

describe('AdapterRegistry — persistence', () => {
  it('returns empty list when registry file is absent', () => {
    const fs = createInMemoryFs();
    const r = new AdapterRegistry({ registryPath: '/tmp/registry.json', fs, clock: createFakeClock() });
    expect(r.list()).toEqual([]);
    expect(r.currentProduction()).toBeUndefined();
    expect(r.currentCanary()).toBeUndefined();
  });

  it('persists upserts atomically (tmp + rename)', () => {
    const fs = createInMemoryFs();
    const r = new AdapterRegistry({ registryPath: '/tmp/r.json', fs, clock: createFakeClock() });
    r.upsert(makeEntry());
    const dump = fs.dump();
    expect(dump['/tmp/r.json']).toBeDefined();
    expect(JSON.parse(dump['/tmp/r.json']!).entries).toHaveLength(1);
  });

  it('upsert is idempotent on adapterName', () => {
    const fs = createInMemoryFs();
    const r = new AdapterRegistry({ registryPath: '/tmp/r.json', fs, clock: createFakeClock() });
    r.upsert(makeEntry());
    r.upsert(makeEntry({ adapterPath: '/different/path' }));
    expect(r.list()).toHaveLength(1);
    expect(r.list()[0]!.adapterPath).toBe('/different/path');
  });

  it('keeps a .bak file on second write', () => {
    const fs = createInMemoryFs();
    const r = new AdapterRegistry({ registryPath: '/tmp/r.json', fs, clock: createFakeClock() });
    r.upsert(makeEntry({ adapterName: 'first' }));
    r.upsert(makeEntry({ adapterName: 'second' }));
    expect(fs.exists('/tmp/r.json.bak')).toBe(true);
  });

  it('throws RegistryCorruptError on malformed JSON', () => {
    const fs = createInMemoryFs();
    fs.put('/tmp/r.json', '{ broken');
    const r = new AdapterRegistry({ registryPath: '/tmp/r.json', fs, clock: createFakeClock() });
    expect(() => r.list()).toThrow(RegistryCorruptError);
  });

  it('treats empty file as empty registry', () => {
    const fs = createInMemoryFs();
    fs.put('/tmp/r.json', '');
    const r = new AdapterRegistry({ registryPath: '/tmp/r.json', fs, clock: createFakeClock() });
    expect(r.list()).toEqual([]);
  });
});

describe('AdapterRegistry — invariants', () => {
  it('rejects duplicate adapterName', () => {
    const fs = createInMemoryFs();
    const r = new AdapterRegistry({ registryPath: '/tmp/r.json', fs, clock: createFakeClock() });
    expect(() =>
      r.assertInvariants([makeEntry({ adapterName: 'a' }), makeEntry({ adapterName: 'a' })])
    ).toThrow(RegistryInvariantError);
  });

  it('rejects two production entries', () => {
    const r = new AdapterRegistry({
      registryPath: '/tmp/r.json',
      fs: createInMemoryFs(),
      clock: createFakeClock()
    });
    expect(() =>
      r.assertInvariants([
        makeEntry({ adapterName: 'a', status: 'production', ollamaModelName: 'a' }),
        makeEntry({ adapterName: 'b', status: 'production', ollamaModelName: 'b' })
      ])
    ).toThrow(RegistryInvariantError);
  });

  it('rejects two canary entries', () => {
    const r = new AdapterRegistry({
      registryPath: '/tmp/r.json',
      fs: createInMemoryFs(),
      clock: createFakeClock()
    });
    expect(() =>
      r.assertInvariants([
        makeEntry({ adapterName: 'a', status: 'canary', canaryPercent: 10 }),
        makeEntry({ adapterName: 'b', status: 'canary', canaryPercent: 5 })
      ])
    ).toThrow(RegistryInvariantError);
  });

  it('rejects archived without archivedAt', () => {
    const r = new AdapterRegistry({
      registryPath: '/tmp/r.json',
      fs: createInMemoryFs(),
      clock: createFakeClock()
    });
    expect(() => r.assertInvariants([makeEntry({ status: 'archived' })])).toThrow(
      RegistryInvariantError
    );
  });

  it('rejects archivedAt on non-archived entry', () => {
    const r = new AdapterRegistry({
      registryPath: '/tmp/r.json',
      fs: createInMemoryFs(),
      clock: createFakeClock()
    });
    expect(() =>
      r.assertInvariants([
        makeEntry({ status: 'production', archivedAt: '2026-05-06T00:00:00.000Z', ollamaModelName: 'x' })
      ])
    ).toThrow(RegistryInvariantError);
  });

  it('rejects canary without canaryPercent', () => {
    const r = new AdapterRegistry({
      registryPath: '/tmp/r.json',
      fs: createInMemoryFs(),
      clock: createFakeClock()
    });
    expect(() => r.assertInvariants([makeEntry({ status: 'canary' })])).toThrow(
      RegistryInvariantError
    );
  });

  it('rejects rejected without rejectionReason', () => {
    const r = new AdapterRegistry({
      registryPath: '/tmp/r.json',
      fs: createInMemoryFs(),
      clock: createFakeClock()
    });
    expect(() => r.assertInvariants([makeEntry({ status: 'rejected' })])).toThrow(
      RegistryInvariantError
    );
  });
});

describe('AdapterRegistry — transitions', () => {
  it('transition() updates status + appends history', () => {
    const fs = createInMemoryFs();
    const r = new AdapterRegistry({ registryPath: '/tmp/r.json', fs, clock: createFakeClock() });
    r.upsert(makeEntry());
    const updated = r.transition('2026-05-06-qwen', 'canary', (e) => {
      e.canaryPercent = 10;
      e.ollamaModelName = 'm-canary';
    });
    expect(updated.status).toBe('canary');
    expect(updated.canaryPercent).toBe(10);
    expect(updated.history).toHaveLength(2);
    expect(updated.history[1]!.fromStatus).toBe('registered');
    expect(updated.history[1]!.toStatus).toBe('canary');
  });

  it('transition() throws RegistryStateMismatchError for unknown adapter', () => {
    const r = new AdapterRegistry({
      registryPath: '/tmp/r.json',
      fs: createInMemoryFs(),
      clock: createFakeClock()
    });
    expect(() => r.transition('nonexistent', 'production', () => {})).toThrow(
      RegistryStateMismatchError
    );
  });

  it('clears canaryPercent when leaving canary state', () => {
    const fs = createInMemoryFs();
    const r = new AdapterRegistry({ registryPath: '/tmp/r.json', fs, clock: createFakeClock() });
    r.upsert(makeEntry({ status: 'canary', canaryPercent: 10, ollamaModelName: 'c' }));
    const updated = r.transition('2026-05-06-qwen', 'production', (e) => {
      e.ollamaModelName = 'p';
    });
    expect(updated.canaryPercent).toBeUndefined();
    expect(updated.status).toBe('production');
  });
});

describe('AdapterRegistry — static guards', () => {
  it('assertValidTransition allows registered → canary', () => {
    expect(() => AdapterRegistry.assertValidTransition('registered', 'canary')).not.toThrow();
  });

  it('assertValidTransition rejects production → registered', () => {
    expect(() => AdapterRegistry.assertValidTransition('production', 'registered')).toThrow(
      RegistryStateMismatchError
    );
  });

  it('assertValidTransition allows archived → production (rollback)', () => {
    expect(() => AdapterRegistry.assertValidTransition('archived', 'production')).not.toThrow();
  });

  it('assertValidTransition rejects rejected → anything', () => {
    expect(() => AdapterRegistry.assertValidTransition('rejected', 'production')).toThrow(
      RegistryStateMismatchError
    );
    expect(() => AdapterRegistry.assertValidTransition('rejected', 'canary')).toThrow(
      RegistryStateMismatchError
    );
  });

  it('assertRollbackTarget requires archived', () => {
    expect(() => AdapterRegistry.assertRollbackTarget(makeEntry({ status: 'production', ollamaModelName: 'x' }))).toThrow(
      RollbackTargetInvalidError
    );
    expect(() =>
      AdapterRegistry.assertRollbackTarget(
        makeEntry({ status: 'archived', archivedAt: '2026-05-06T00:00:00.000Z' })
      )
    ).not.toThrow();
  });

  it('assertCanaryPercent rejects out-of-range values', () => {
    expect(() => AdapterRegistry.assertCanaryPercent(-1)).toThrow(CanaryPercentOutOfRangeError);
    expect(() => AdapterRegistry.assertCanaryPercent(101)).toThrow(CanaryPercentOutOfRangeError);
    expect(() => AdapterRegistry.assertCanaryPercent(NaN)).toThrow(CanaryPercentOutOfRangeError);
    expect(() => AdapterRegistry.assertCanaryPercent(0)).not.toThrow();
    expect(() => AdapterRegistry.assertCanaryPercent(100)).not.toThrow();
    expect(() => AdapterRegistry.assertCanaryPercent(50)).not.toThrow();
  });
});

describe('AdapterRegistry — drop', () => {
  it('removes an entry by name', () => {
    const fs = createInMemoryFs();
    const r = new AdapterRegistry({ registryPath: '/tmp/r.json', fs, clock: createFakeClock() });
    r.upsert(makeEntry({ adapterName: 'a' }));
    r.upsert(makeEntry({ adapterName: 'b' }));
    expect(r.list()).toHaveLength(2);
    const removed = r.drop('a');
    expect(removed?.adapterName).toBe('a');
    expect(r.list()).toHaveLength(1);
    expect(r.list()[0]!.adapterName).toBe('b');
  });

  it('returns undefined for unknown name', () => {
    const r = new AdapterRegistry({
      registryPath: '/tmp/r.json',
      fs: createInMemoryFs(),
      clock: createFakeClock()
    });
    expect(r.drop('nonexistent')).toBeUndefined();
  });
});
