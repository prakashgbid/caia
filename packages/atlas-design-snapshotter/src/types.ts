/**
 * Public types for `@caia/atlas-design-snapshotter`.
 *
 * Re-exports `RenderableDesign` from `@chiefaia/atlas-mapper` so callers
 * have a single import surface for the contract.
 */

import type { RenderableDesign } from '@chiefaia/atlas-mapper';
import type { DesignDiff, DiffSummary } from './diff.js';

export type { RenderableDesign };
export type { DesignDiff, DiffSummary } from './diff.js';

/**
 * A persisted design version, as returned by `captureSnapshot`,
 * `getSnapshot`, and `listVersions`. Mirrors the `design_versions`
 * table row.
 */
export interface DesignVersion {
  id: string;
  tenantId: string;
  uxUploadId: string;
  versionNumber: number;
  parentVersionId: string | null;
  renderedDesign: RenderableDesign;
  renderedDesignHash: string;
  diffFromParent: DesignDiff | null;
  diffSummary: DiffSummary | null;
  notes: string | null;
  createdAt: Date;
}

/**
 * Light listing row — same shape as `DesignVersion` but with the heavy
 * `renderedDesign` payload elided. `listVersions` returns these so a UI
 * can show the version-picker without paying the JSON-deserialise cost.
 */
export interface DesignVersionSummary {
  id: string;
  tenantId: string;
  uxUploadId: string;
  versionNumber: number;
  parentVersionId: string | null;
  renderedDesignHash: string;
  diffSummary: DiffSummary | null;
  notes: string | null;
  createdAt: Date;
}

/** Options for `captureSnapshot`. */
export interface CaptureSnapshotOptions {
  notes?: string;
  skipIfUnchanged?: boolean;
}

/** Options for `revertToVersion`. */
export interface RevertOptions {
  notes?: string;
}

/** Options for `deleteAllForTenant`. */
export interface DeleteAllForTenantOptions {
  dryRun?: boolean;
}

/** Outcome of `deleteAllForTenant`. */
export interface DeleteAllForTenantResult {
  deletedVersionCount: number;
  deletedAssetCount: number;
  deletedBlobCount: number;
  tenantTombstoneRef: string;
}
