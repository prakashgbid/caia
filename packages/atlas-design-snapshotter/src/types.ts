/**
 * @chiefaia/atlas-design-snapshotter — public types.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §1 (RenderableDesign),
 * §4 (design_versions/ux_uploads/design_assets schemas), §5.2 (Diff JSON
 * shape), §5.3 (revert mechanic). See also research/atlas_module_spec_2026.md
 * §2 (DOM-ID model).
 *
 * The shapes here mirror — but do NOT import from — @chiefaia/atlas-mapper.
 * Decoupling at the type level keeps this package buildable while atlas-mapper
 * is being authored, and respects the Option-E "parameterised public API"
 * rule (AGENTS.md): every external coupling is a constructor parameter.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// RenderableDesign (the snapshot payload). Mirrors step5 §1 + the atlas-mapper
// type projection. Only the fields the snapshotter actually reads are required;
// everything else is optional pass-through so adapters can round-trip a full
// payload without losing data.
// ---------------------------------------------------------------------------

export type NodeRole = 'page' | 'section' | 'widget' | 'story-host' | 'leaf' | 'shared-ref';
export type NodeLevel = 'page' | 'section' | 'widget' | 'leaf';

export interface RenderableNode {
  domId?: string;
  tag: string;
  role: NodeRole;
  level?: NodeLevel;
  attrs?: Record<string, any>;
  resolvedStyle?: Record<string, any>;
  copyRefs?: string[];
  assetRefs?: string[];
  interactivityRefs?: string[];
  sharedRef?: string | null;
  bounds?: { x: number; y: number; w: number; h: number };
  provenance?: Record<string, any>;
  children?: RenderableNode[];
}

export interface RenderableComponentTree {
  rootDomId?: string;
  node: RenderableNode;
}

export interface RenderableCopy {
  domId: string;
  text: string;
  locale?: string;
  richText?: boolean;
}

/**
 * Asset entry — exactly as it appears on `RenderableDesign.assets[]`. The
 * snapshotter walks this list to upload + dedup blobs; on the way out it
 * stamps `storageUrl` so consumers can render directly without a join.
 */
export interface RenderableAsset {
  /** Logical path within the design (e.g. '/headshot.jpg'). */
  path: string;
  /** Adapter-side temporary upload path (e.g. /tmp/xyz.png). */
  uploadedSourcePath?: string;
  kind?: string;
  alt?: string;
  /** SHA-256 of the asset bytes. If absent on input, the snapshotter computes it. */
  contentHash?: string;
  byteSize?: number;
  intrinsicSize?: { w: number; h: number };
  /** Filled in by the snapshotter after blob upload. Format: e.g. `s3://...`. */
  storageUrl?: string;
  isPlaceholder?: boolean;
}

export interface RenderableDesignTokens {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  spacing?: Record<string, string>;
  radii?: Record<string, string>;
  shadows?: Record<string, string>;
  rawSource?: string;
}

export interface RenderableRoute {
  path: string;
  title?: string;
  componentTreeId: string;
  breakpoints?: string[];
  metadata?: Record<string, any>;
}

export interface RenderableInteractivity {
  domId: string;
  kind: string;
  target?: string;
  ariaLabel?: string;
  rolesFromSource?: string[];
}

export interface RenderableSharedComponent {
  id: string;
  domIdPrefix?: string;
  node: RenderableNode;
  usedByDomIds?: string[];
}

export interface RenderableDesign {
  /** Set on persisted snapshots; may be undefined on the in-flight payload. */
  designVersionId?: string;
  source?: string;
  routes: RenderableRoute[];
  componentTrees: Record<string, RenderableComponentTree>;
  sharedComponents?: RenderableSharedComponent[];
  copy?: RenderableCopy[];
  assets?: RenderableAsset[];
  interactivity?: RenderableInteractivity[];
  designTokens?: RenderableDesignTokens;
  sourceMetadata?: Record<string, any>;
  site?: Record<string, any>;
  rawSourceArtifacts?: Record<string, any>;
  ingestDiagnostics?: Record<string, any>;
  tenantId?: string;
  businessProposalId?: string;
  uploadedAt?: string;
}

// ---------------------------------------------------------------------------
// Diff (the value that lands in design_versions.diff_from_parent).
//
// Mirrors @chiefaia/atlas-mapper's `DesignDiff` documented shape:
//   { added: DomIdEntry[], removed: DomIdEntry[], modified: ModifiedEntry[] }
//
// We additionally project a compact `DiffSummary` (counts only) that the
// dashboard's version-picker reads — it's expensive to render the full diff
// for a 600-node design, but the summary is one row.
// ---------------------------------------------------------------------------

export type DiffReason =
  | 'attrs_changed'
  | 'position_changed'
  | 'token_changed'
  | 'copy_changed'
  | 'asset_changed';

export interface DomIdEntry {
  domId: string;
  parentDomId?: string | null;
  role?: NodeRole;
  tag?: string;
  bounds?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, any>;
}

export interface ModifiedEntry {
  domId: string;
  reasons: DiffReason[];
  before?: DomIdEntry;
  after?: DomIdEntry;
}

export interface Diff {
  added: DomIdEntry[];
  removed: DomIdEntry[];
  modified: ModifiedEntry[];
}

export interface DiffSummary {
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  reasonCounts: Record<DiffReason, number>;
}

export type DiffDesignsFn = (parent: RenderableDesign, child: RenderableDesign) => Diff;

// ---------------------------------------------------------------------------
// Persisted row shapes.
// ---------------------------------------------------------------------------

export interface DesignVersionRow {
  id: string;
  uxUploadId: string;
  versionNumber: number;
  parentVersionId: string | null;
  createdAt: Date;
  diffFromParent: Diff | null;
  diffSummary: DiffSummary | null;
  notes: string | null;
  /** Hydrated from ux_uploads.rendered_design on read APIs that ask for it. */
  renderableDesign?: RenderableDesign;
}

export interface DesignAssetRow {
  id: string;
  uxUploadId: string;
  designVersionId: string;
  path: string;
  kind: string;
  contentHash: string;
  storageUrl: string;
  sizeBytes: number;
  altText: string | null;
  intrinsicW: number | null;
  intrinsicH: number | null;
  isPlaceholder: boolean;
}

// ---------------------------------------------------------------------------
// Injection contracts.
// ---------------------------------------------------------------------------

/**
 * Minimal node-postgres-compatible client interface. `pg.Client`, `pg.Pool`,
 * and our `FakePg` all satisfy this. The shape is intentionally narrow so
 * implementations don't need to support cursors, COPY, or notifications.
 *
 * `query` must support the `$1, $2, ...` parameterisation node-postgres uses.
 */
export interface PgQueryable {
  query<R = any>(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: R[]; rowCount?: number | null }>;
}

/**
 * Pluggable per-tenant blob storage — the BYOC adapter interface. The default
 * production adapter wraps S3 / R2 / GCS; tests inject `FakeBlobStorage`.
 *
 * Paths are tenant-bucket-relative — the adapter is responsible for tenant
 * isolation (one bucket per tenant in the default deployment).
 */
export interface BlobStorage {
  /**
   * Idempotent. If a blob already exists at `path` and its sha matches the
   * caller's hash, the adapter returns the existing URL without re-uploading.
   * Returning `deduped: true` lets the snapshotter record the hit for metrics.
   */
  put(args: {
    path: string;
    bytes: Uint8Array;
    contentHash: string;
    contentType?: string;
  }): Promise<{ storageUrl: string; deduped: boolean }>;

  /** Returns metadata only — no body. Used to short-circuit dedup checks. */
  head(path: string): Promise<{ exists: boolean; contentHash?: string; sizeBytes?: number }>;

  /** Returns the bytes. */
  get(path: string): Promise<Uint8Array>;

  /** Idempotent — deleting a missing path is a no-op. */
  delete(path: string): Promise<void>;

  /** Lists paths under a prefix. Used by GDPR delete to enumerate per-tenant blobs. */
  list(prefix: string): Promise<string[]>;
}

/** Function used to source raw bytes for an asset. */
export type AssetByteReader = (asset: RenderableAsset) => Promise<Uint8Array>;

// ---------------------------------------------------------------------------
// Constructor + API arg shapes.
// ---------------------------------------------------------------------------

export interface SnapshotterOptions {
  pg: PgQueryable;
  blobStorage: BlobStorage;
  diffDesigns: DiffDesignsFn;
  /** Per-tenant Postgres schema — e.g. `caia_pt_dev`. */
  schema: string;
  /** Tenant identifier — used by GDPR delete + audit. */
  tenantId: string;
  /** Reads raw bytes for assets that don't already have `storageUrl`. */
  assetByteReader?: AssetByteReader;
  /** Default 'design-assets'. */
  blobPathPrefix?: string;
  /** Default `crypto.randomUUID`. */
  idGen?: () => string;
  /** Default `() => new Date()`. */
  clock?: () => Date;
}

export interface SnapshotInput {
  uxUploadId: string;
  design: RenderableDesign;
  notes?: string;
}

export interface RevertInput {
  uxUploadId: string;
  versionNumber: number;
  notes?: string;
}

export interface DesignSnapshotter {
  snapshot(input: SnapshotInput): Promise<DesignVersionRow>;
  revertToVersion(input: RevertInput): Promise<DesignVersionRow>;
  deleteAllForTenant(tenantId: string): Promise<{ deletedVersionCount: number; deletedBlobCount: number }>;
  getSnapshot(designVersionId: string): Promise<RenderableDesign>;
  listVersions(uxUploadId: string): Promise<Array<{
    designVersionId: string;
    versionNumber: number;
    parentVersionId: string | null;
    createdAt: Date;
    diffSummary: DiffSummary | null;
    notes: string | null;
  }>>;
  getDiff(fromVersionId: string, toVersionId: string): Promise<Diff>;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export type SnapshotterErrorCode =
  | 'ux_upload_not_found'
  | 'design_version_not_found'
  | 'invalid_renderable_design'
  | 'invalid_revert_target'
  | 'asset_bytes_missing'
  | 'diff_failed'
  | 'tenant_mismatch';

export class SnapshotterError extends Error {
  public readonly code: SnapshotterErrorCode;
  public readonly context: Record<string, unknown>;

  constructor(code: SnapshotterErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SnapshotterError';
    this.code = code;
    this.context = context;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, SnapshotterError);
    }
  }
}
