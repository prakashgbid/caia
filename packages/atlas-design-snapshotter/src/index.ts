/**
 * `@caia/atlas-design-snapshotter` — public surface.
 *
 * The version-control half of Atlas / Step 5: captures immutable,
 * parent-linked snapshots of every RenderableDesign upload, dedups
 * assets by content hash via the tenant's BYOC adapter, and serves
 * "revert to version N" by forward-creating v(N+1) = v(N).
 *
 * Reference:
 *   - research/step5_design_ingest_spec_2026.md §4-§5
 *   - research/atlas_module_spec_2026.md §7
 *   - research/17_architect_framework_spec_2026.md Architect #15
 */

export { DesignSnapshotter } from './snapshotter.js';
export type {
  DesignSnapshotterOptions,
  ResolveTenantSchema,
  ResolveTenantBlobPrefix,
} from './snapshotter.js';

export {
  diffDesigns,
  emptyDiff,
  summarizeDiff,
} from './diff.js';
export type {
  DesignDiff,
  DiffSummary,
  NodeMove,
  NodePropsChange,
  TokenValueChange,
  CopyTextChange,
  AssetHashChange,
} from './diff.js';

export { sha256, hashValue, canonicalJson } from './hash.js';

export {
  InMemoryBYOCAdapter,
} from './byoc-adapter.js';
export type {
  BYOCBlobAdapter,
  BYOCPutResult,
  BYOCHeadResult,
} from './byoc-adapter.js';

export { SnapshotterError } from './errors.js';
export type { SnapshotterErrorCode } from './errors.js';

export type {
  DesignVersion,
  DesignVersionSummary,
  CaptureSnapshotOptions,
  RevertOptions,
  DeleteAllForTenantOptions,
  DeleteAllForTenantResult,
  RenderableDesign,
} from './types.js';

export type { PoolLike, PoolClientLike, QueryResultLike } from './pg-types.js';
