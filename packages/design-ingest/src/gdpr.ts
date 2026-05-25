/**
 * `GdprCoordinator` — orchestrates Article-17 right-to-erasure across
 * the three surfaces design-ingest touches:
 *
 *   1. `ux_uploads` rows           — owned by this package.
 *   2. `design_versions` + assets  — owned by `@caia/atlas-design-snapshotter`.
 *   3. Secrets                     — owned by `@caia/secrets-adapter`.
 *
 * Each step runs INDEPENDENTLY and reports its own outcome.
 * `failures[]` enumerates partial failures so an operator can retry
 * just the broken sub-step without re-running the others.
 *
 * Sequence is intentional: snapshotter first (heaviest — blob storage),
 * ux_uploads second, secrets third. Per-step failures do NOT abort
 * later steps — we want maximum erasure even on partial failure.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §11 ("GDPR").
 */

import type { SecretsAdapter } from '@caia/secrets-adapter';
import type { DesignSnapshotter } from '@caia/atlas-design-snapshotter';
import type { UxUploadsRepo } from './persistence.js';
import type {
  DeleteAllForTenantOptions,
  DeleteAllForTenantResult,
} from './types.js';

export interface GdprCoordinatorDeps {
  snapshotter: DesignSnapshotter;
  uxUploads: UxUploadsRepo;
  secrets: SecretsAdapter;
  /** Test-injectable clock. */
  now?: () => Date;
}

export class GdprCoordinator {
  private readonly snapshotter: DesignSnapshotter;
  private readonly uxUploads: UxUploadsRepo;
  private readonly secrets: SecretsAdapter;
  private readonly now: () => Date;

  constructor(deps: GdprCoordinatorDeps) {
    this.snapshotter = deps.snapshotter;
    this.uxUploads = deps.uxUploads;
    this.secrets = deps.secrets;
    this.now = deps.now ?? ((): Date => new Date());
  }

  async deleteAllForTenant(
    tenantId: string,
    opts: DeleteAllForTenantOptions = {},
  ): Promise<DeleteAllForTenantResult> {
    const failures: DeleteAllForTenantResult['failures'] = [];

    // 1. snapshotter (versions + assets + blobs)
    let snapshotterResult: DeleteAllForTenantResult['snapshotter'] = null;
    try {
      const snapOpts = opts.dryRun ? { dryRun: true } : {};
      const r = await this.snapshotter.deleteAllForTenant(tenantId, snapOpts);
      snapshotterResult = {
        deletedVersionCount: r.deletedVersionCount,
        deletedAssetCount: r.deletedAssetCount,
        deletedBlobCount: r.deletedBlobCount,
        tenantTombstoneRef: r.tenantTombstoneRef,
      };
    } catch (err) {
      failures.push({
        step: 'snapshotter',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. ux_uploads
    let uxUploadsResult: DeleteAllForTenantResult['uxUploads'] = null;
    try {
      const opts2 = opts.dryRun ? { dryRun: true } : {};
      const r = await this.uxUploads.deleteAllForTenant(tenantId, opts2);
      uxUploadsResult = { deletedCount: r.deletedCount };
    } catch (err) {
      failures.push({
        step: 'ux_uploads',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 3. secrets
    let secretsResult: DeleteAllForTenantResult['secrets'] = null;
    try {
      const opts3 = opts.dryRun ? { dryRun: true } : {};
      const r = await this.secrets.deleteAllForTenant(tenantId, opts3);
      secretsResult = {
        deletedCount: r.deletedCount,
        tenantTombstoneRef: r.tenantTombstoneRef,
      };
    } catch (err) {
      failures.push({
        step: 'secrets',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      tenantId,
      snapshotter: snapshotterResult,
      uxUploads: uxUploadsResult,
      secrets: secretsResult,
      failures,
      completedAt: this.now(),
      dryRun: opts.dryRun ?? false,
    };
  }
}
