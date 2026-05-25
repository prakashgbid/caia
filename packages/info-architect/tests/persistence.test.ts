import { describe, expect, it } from 'vitest';

import { synthesiseSkeletonOutput } from '../src/agent.js';
import {
  IaMemoryPersistence,
  tenantSchemaName,
} from '../src/persistence.js';
import { InfoArchitectError } from '../src/errors.js';
import { buildIaInput } from './fixtures.js';

const CLOCK = (): Date => new Date('2026-05-25T12:00:00.000Z');

describe('IaMemoryPersistence', () => {
  it('seedInput round-trips through readInput', async () => {
    const persistence = new IaMemoryPersistence({ clock: CLOCK });
    const input = buildIaInput();
    persistence.seedInput(input.projectId, input);
    expect(await persistence.readInput(input.projectId)).toBe(input);
  });

  it('returns null for an unknown projectId', async () => {
    const persistence = new IaMemoryPersistence({ clock: CLOCK });
    expect(await persistence.readInput('unknown')).toBeNull();
  });

  it('writeArtifacts records a row keyed by projectId', async () => {
    const persistence = new IaMemoryPersistence({ clock: CLOCK });
    const input = buildIaInput();
    const out = synthesiseSkeletonOutput(input, CLOCK);
    const r = await persistence.writeArtifacts(input.projectId, out);
    expect(r.revisionId).toBe(out.pagesCatalogue.revisionId);
    expect(persistence.listRows().length).toBe(1);
  });

  it('writeArtifacts is idempotent — second write overwrites in place', async () => {
    const persistence = new IaMemoryPersistence({ clock: CLOCK });
    const input = buildIaInput();
    const out = synthesiseSkeletonOutput(input, CLOCK);
    await persistence.writeArtifacts(input.projectId, out);
    await persistence.writeArtifacts(input.projectId, out);
    expect(persistence.listRows().length).toBe(1);
  });

  it('readLatestArtifacts returns the persisted output', async () => {
    const persistence = new IaMemoryPersistence({ clock: CLOCK });
    const input = buildIaInput();
    const out = synthesiseSkeletonOutput(input, CLOCK);
    await persistence.writeArtifacts(input.projectId, out);
    const got = await persistence.readLatestArtifacts(input.projectId);
    expect(got?.pagesCatalogue.revisionId).toBe(out.pagesCatalogue.revisionId);
  });

  it('readLatestArtifacts returns null when nothing has been written', async () => {
    const persistence = new IaMemoryPersistence({ clock: CLOCK });
    expect(await persistence.readLatestArtifacts('11111111-1111-1111-1111-111111111111')).toBeNull();
  });

  it('ensureSchema is a no-op (in-memory)', async () => {
    const persistence = new IaMemoryPersistence({ clock: CLOCK });
    await expect(persistence.ensureSchema()).resolves.toBeUndefined();
  });

  it('tenantSchema defaults to caia_memtest', () => {
    const persistence = new IaMemoryPersistence({ clock: CLOCK });
    expect(persistence.tenantSchema).toBe('caia_memtest');
  });

  it('inputs option pre-seeds the map', async () => {
    const input = buildIaInput();
    const persistence = new IaMemoryPersistence({
      clock: CLOCK,
      inputs: [[input.projectId, input]],
    });
    expect(await persistence.readInput(input.projectId)).toBe(input);
  });
});

describe('tenantSchemaName', () => {
  it('produces a caia_-prefixed snake-cased schema name', () => {
    expect(tenantSchemaName('prakash-tiwari')).toBe('caia_prakash_tiwari');
  });

  it('lowercases mixed-case input', () => {
    expect(tenantSchemaName('Acme-Co')).toBe('caia_acme_co');
  });

  it('clips the slug at 24 chars', () => {
    const s = tenantSchemaName('a-very-long-tenant-slug-that-exceeds-the-limit');
    expect(s.length).toBeLessThanOrEqual(5 + 24); // 'caia_' + 24
  });

  it('rejects invalid slugs', () => {
    expect(() => tenantSchemaName('"; DROP TABLE x; --')).toThrow(InfoArchitectError);
  });

  it('rejects an empty slug', () => {
    expect(() => tenantSchemaName('')).toThrow(InfoArchitectError);
  });

  it('rejects slugs starting with a special char', () => {
    expect(() => tenantSchemaName('-leading-dash')).toThrow(InfoArchitectError);
  });
});
