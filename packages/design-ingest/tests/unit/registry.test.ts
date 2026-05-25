import { afterEach, describe, expect, it } from 'vitest';
import {
  DESIGN_ADAPTER_REGISTRY,
  Registry,
  registerAdapter,
  getDesignAdapterForTenant,
} from '../../src/registry.js';
import { ProviderNotSupported, DesignIngestError } from '../../src/errors.js';
import { StubAdapter, adapterDepsForTests, asSecrets, asSnapshotter, StubSecrets, StubSnapshotter } from '../helpers/fixtures.js';
import { FakePool } from '../helpers/fake-pg.js';

describe('Registry', () => {
  it('register + resolve round-trips', () => {
    const reg = new Registry();
    reg.register('cd-zip', StubAdapter);
    expect(reg.has('cd-zip')).toBe(true);
    expect(reg.list()).toEqual(['cd-zip']);
  });

  it('register throws on duplicate without force', () => {
    const reg = new Registry();
    reg.register('cd-zip', StubAdapter);
    expect(() => reg.register('cd-zip', StubAdapter)).toThrow(DesignIngestError);
  });

  it('register accepts force: true override', () => {
    const reg = new Registry();
    reg.register('cd-zip', StubAdapter);
    expect(() => reg.register('cd-zip', StubAdapter, { force: true })).not.toThrow();
  });

  it('clear removes all', () => {
    const reg = new Registry();
    reg.register('cd-zip', StubAdapter);
    reg.clear();
    expect(reg.has('cd-zip')).toBe(false);
  });

  it('resolve throws ProviderNotSupported on miss', () => {
    const reg = new Registry();
    const pg = new FakePool();
    const deps = adapterDepsForTests({
      pg,
      snapshotter: asSnapshotter(new StubSnapshotter()),
      secrets: asSecrets(new StubSecrets()),
    });
    expect(() => reg.resolve('figma-json', deps)).toThrow(ProviderNotSupported);
  });
});

describe('getDesignAdapterForTenant', () => {
  afterEach(() => DESIGN_ADAPTER_REGISTRY.clear());

  it('looks up preferred source then resolves the adapter', async () => {
    registerAdapter('cd-zip', StubAdapter);
    const pg = new FakePool();
    pg.insertTenant({ id: 't1', preferred_design_source: 'cd-zip' });
    const deps = adapterDepsForTests({
      pg,
      snapshotter: asSnapshotter(new StubSnapshotter()),
      secrets: asSecrets(new StubSecrets()),
    });
    const adapter = await getDesignAdapterForTenant('t1', deps);
    expect(adapter.sourceName).toBe('cd-zip');
  });

  it('throws tenant_not_found if no row', async () => {
    registerAdapter('cd-zip', StubAdapter, { force: true });
    const pg = new FakePool();
    const deps = adapterDepsForTests({
      pg,
      snapshotter: asSnapshotter(new StubSnapshotter()),
      secrets: asSecrets(new StubSecrets()),
    });
    await expect(getDesignAdapterForTenant('missing', deps)).rejects.toThrow(
      /tenant.*not found/i,
    );
  });

  it('respects custom resolver', async () => {
    const reg = new Registry();
    reg.register('figma-json', StubAdapter);
    const pg = new FakePool();
    const deps = adapterDepsForTests({
      pg,
      snapshotter: asSnapshotter(new StubSnapshotter()),
      secrets: asSecrets(new StubSecrets()),
    });
    const a = await getDesignAdapterForTenant('any', deps, {
      registry: reg,
      resolveSource: async () => 'figma-json',
    });
    expect(a.sourceName).toBe('cd-zip'); // StubAdapter's default
  });
});
