/**
 * Public entry point for @chiefaia/atlas-design-snapshotter.
 *
 * Re-exports the factory, types, and the SQL/dedup helpers. Add future
 * versions as parallel exports — never mutate v1.
 */

export { createDesignSnapshotter } from './snapshotter.js';

export type {
  AssetByteReader,
  BlobStorage,
  DesignAssetRow,
  DesignSnapshotter,
  DesignVersionRow,
  Diff,
  DiffDesignsFn,
  DiffReason,
  DiffSummary,
  DomIdEntry,
  ModifiedEntry,
  NodeLevel,
  NodeRole,
  PgQueryable,
  RenderableAsset,
  RenderableComponentTree,
  RenderableCopy,
  RenderableDesign,
  RenderableDesignTokens,
  RenderableInteractivity,
  RenderableNode,
  RenderableRoute,
  RenderableSharedComponent,
  RevertInput,
  SnapshotInput,
  SnapshotterErrorCode,
  SnapshotterOptions,
} from './types.js';

export { SnapshotterError } from './types.js';
export { summarise, emptyDiff } from './diff.js';
export { sha256, sha256Of, canonicalJsonStringify } from './content-hash.js';
export { schemaDDL, assertSafeSchemaName } from './sql.js';
