import { describe, expect, it } from 'vitest';
import { UxUploadsRepo } from '../../src/persistence.js';
import { FakePool } from '../helpers/fake-pg.js';
import { minimalDesign } from '../helpers/fixtures.js';
import { DesignIngestError } from '../../src/errors.js';

describe('UxUploadsRepo', () => {
  it('insert creates a uploading row', async () => {
    const pg = new FakePool();
    const repo = new UxUploadsRepo(pg);
    const row = await repo.insert({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: { adapterVersion: '0.1.0' },
    });
    expect(row.status).toBe('uploading');
    expect(row.tenantId).toBe('t1');
    expect(row.source).toBe('cd-zip');
  });

  it('getById returns the row by id', async () => {
    const pg = new FakePool();
    const repo = new UxUploadsRepo(pg);
    const inserted = await repo.insert({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    const found = await repo.getById(inserted.id);
    expect(found?.id).toBe(inserted.id);
  });

  it('getById returns null when missing', async () => {
    const pg = new FakePool();
    const repo = new UxUploadsRepo(pg);
    const found = await repo.getById('does-not-exist');
    expect(found).toBeNull();
  });

  it('markParsing → markParsed transitions through statuses', async () => {
    const pg = new FakePool();
    const repo = new UxUploadsRepo(pg);
    const r = await repo.insert({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    await repo.markParsing(r.id);
    expect((await repo.getById(r.id))?.status).toBe('parsing');
    await repo.markParsed(r.id, minimalDesign(), 1234, { warnings: [] });
    const final = await repo.getById(r.id);
    expect(final?.status).toBe('parsed');
    expect(final?.parseDurationMs).toBe(1234);
    expect(final?.renderedDesign?.designVersionId).toBe('dv-test-1');
  });

  it('markFailed records reason + diagnostics', async () => {
    const pg = new FakePool();
    const repo = new UxUploadsRepo(pg);
    const r = await repo.insert({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    await repo.markParsing(r.id);
    await repo.markFailed(r.id, 'parse timed out', 60_000, { cause: 'timeout' });
    const final = await repo.getById(r.id);
    expect(final?.status).toBe('failed');
    expect(final?.failureReason).toBe('parse timed out');
  });

  it('markParsing throws when ux_upload missing', async () => {
    const pg = new FakePool();
    const repo = new UxUploadsRepo(pg);
    await expect(repo.markParsing('nope')).rejects.toThrow(DesignIngestError);
  });

  it('deleteAllForTenant returns count and removes rows', async () => {
    const pg = new FakePool();
    const repo = new UxUploadsRepo(pg);
    for (let i = 0; i < 3; i++) {
      await repo.insert({ tenantId: 't1', source: 'cd-zip', sourceMetadata: {} });
    }
    await repo.insert({ tenantId: 't2', source: 'cd-zip', sourceMetadata: {} });
    const r = await repo.deleteAllForTenant('t1');
    expect(r.deletedCount).toBe(3);
    expect(pg.ux_uploads).toHaveLength(1);
  });

  it('deleteAllForTenant dryRun counts without deleting', async () => {
    const pg = new FakePool();
    const repo = new UxUploadsRepo(pg);
    for (let i = 0; i < 2; i++) {
      await repo.insert({ tenantId: 't1', source: 'cd-zip', sourceMetadata: {} });
    }
    const r = await repo.deleteAllForTenant('t1', { dryRun: true });
    expect(r.deletedCount).toBe(2);
    expect(pg.ux_uploads).toHaveLength(2);
  });
});
