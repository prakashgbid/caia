import { describe, expect, it } from 'vitest';
import { GdprCoordinator } from '../../src/gdpr.js';
import { UxUploadsRepo } from '../../src/persistence.js';
import { FakePool } from '../helpers/fake-pg.js';
import {
  StubSecrets,
  StubSnapshotter,
  asSecrets,
  asSnapshotter,
} from '../helpers/fixtures.js';

function setup() {
  const pg = new FakePool();
  const repo = new UxUploadsRepo(pg);
  const snap = new StubSnapshotter();
  const secrets = new StubSecrets();
  const coord = new GdprCoordinator({
    snapshotter: asSnapshotter(snap),
    uxUploads: repo,
    secrets: asSecrets(secrets),
  });
  return { pg, repo, snap, secrets, coord };
}

describe('GdprCoordinator.deleteAllForTenant', () => {
  it('happy path: all three sub-steps report success', async () => {
    const { pg, coord, snap, secrets } = setup();
    for (let i = 0; i < 2; i++) {
      await new UxUploadsRepo(pg).insert({
        tenantId: 't1',
        source: 'cd-zip',
        sourceMetadata: {},
      });
    }
    const r = await coord.deleteAllForTenant('t1');
    expect(r.tenantId).toBe('t1');
    expect(r.snapshotter?.deletedVersionCount).toBe(3);
    expect(r.uxUploads?.deletedCount).toBe(2);
    expect(r.secrets?.deletedCount).toBe(4);
    expect(r.failures).toHaveLength(0);
    expect(snap.deleteCalls).toEqual(['t1']);
    expect(secrets.deleteCalls).toEqual(['t1']);
  });

  it('collects per-step failures without aborting', async () => {
    const { coord, snap, secrets } = setup();
    snap.deleteFails = true;
    secrets.deleteFails = true;
    const r = await coord.deleteAllForTenant('t1');
    expect(r.snapshotter).toBeNull();
    expect(r.secrets).toBeNull();
    expect(r.uxUploads).not.toBeNull();
    expect(r.failures).toHaveLength(2);
    expect(r.failures.map((f) => f.step).sort()).toEqual(['secrets', 'snapshotter']);
  });

  it('dryRun does not mutate ux_uploads', async () => {
    const { pg, coord } = setup();
    for (let i = 0; i < 2; i++) {
      await new UxUploadsRepo(pg).insert({
        tenantId: 't1',
        source: 'cd-zip',
        sourceMetadata: {},
      });
    }
    const r = await coord.deleteAllForTenant('t1', { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.uxUploads?.deletedCount).toBe(2);
    expect(pg.ux_uploads).toHaveLength(2);
  });

  it('completedAt is a Date', async () => {
    const { coord } = setup();
    const r = await coord.deleteAllForTenant('t1');
    expect(r.completedAt).toBeInstanceOf(Date);
  });
});
