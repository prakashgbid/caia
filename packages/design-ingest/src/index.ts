/**
 * `@caia/design-ingest` — public surface.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §3 + §4 + §6 + §11.
 *
 * The Step 5 entry surface for every external design source CAIA
 * consumes. Declares the `DesignAdapter` contract, owns `ux_uploads`,
 * wraps `@caia/atlas-design-snapshotter` for versioning, delegates DOM
 * IDs to `@chiefaia/atlas-mapper`, coordinates GDPR delete-all.
 */

// -- Contract -----------------------------------------------------------------
export type {
  AdapterCapabilities,
  AdapterDeps,
  AdapterInput,
  DeleteAllForTenantOptions,
  DeleteAllForTenantResult,
  DesignAdapter,
  DesignAdapterCtor,
  IngestOptions,
  IngestResult,
  InsertUxUploadInput,
  UxUploadRow,
  UxUploadStatus,
  ValidationResult,
  ValidationSeverity,
} from './types.js';

// -- Schema + types from atlas-mapper re-export -------------------------------
export {
  SOURCE_NAMES,
  SourceNameSchema,
  NodeRoleSchema,
  NodeLevelSchema,
  RenderableNodeSchema,
  RenderableComponentTreeSchema,
  RenderableCopySchema,
  RenderableAssetSchema,
  RenderableDesignTokensSchema,
  RenderableRouteSchema,
  RenderableSharedComponentSchema,
  RenderableInteractivitySchema,
  RenderableDesignSchema,
  AdapterCapabilitiesSchema,
  ValidationSeveritySchema,
  ValidationWarningSchema,
  ValidationErrorEntrySchema,
  ValidationResultSchema,
  assertRenderableDesign,
} from './schema.js';
export type {
  NodeLevel,
  NodeRole,
  RenderableAsset,
  RenderableComponentTree,
  RenderableCopy,
  RenderableDesign,
  RenderableDesignTokens,
  RenderableInteractivity,
  RenderableNode,
  RenderableRoute,
  RenderableSharedComponent,
  SourceName,
} from './schema.js';

// -- Registry / dispatcher ----------------------------------------------------
export {
  DESIGN_ADAPTER_REGISTRY,
  Registry,
  registerAdapter,
  getDesignAdapterForTenant,
  defaultResolveTenantPreferredSource,
} from './registry.js';
export type {
  ResolveTenantPreferredSource,
  TenantPreferenceRow,
} from './registry.js';

// -- Persistence --------------------------------------------------------------
export { UxUploadsRepo } from './persistence.js';
export type { DeleteAllUxUploadsResult } from './persistence.js';

// -- Ingestor (orchestrator) --------------------------------------------------
export { Ingestor } from './ingestor.js';
export type { IngestorDeps } from './ingestor.js';

// -- DOM-ID surface (re-exports from atlas-mapper) ----------------------------
export {
  assignStableDomIds,
  buildDomIdMap,
  buildMapper,
  composeDomId,
  diffDesigns,
  nodeFingerprint,
  slugifyTag,
  AtlasMapperError,
  finalizeDomIds,
  buildSegment,
} from './dom-id.js';
export type {
  DomIdEntry,
  DomIdMap,
  Mapper,
  AtlasMapperErrorCode,
  AtlasDesignDiff,
} from './dom-id.js';

// -- GDPR ---------------------------------------------------------------------
export { GdprCoordinator } from './gdpr.js';
export type { GdprCoordinatorDeps } from './gdpr.js';

// -- Pg types -----------------------------------------------------------------
export type { PoolLike, PoolClientLike, QueryResultLike } from './pg-types.js';

// -- Errors -------------------------------------------------------------------
export {
  DesignIngestError,
  IngestionError,
  NotImplementedError,
  ProviderNotSupported,
  RefreshNotSupported,
} from './errors.js';
export type { DesignIngestErrorCode } from './errors.js';

// -- Claude Design adapter (Phase B B2) ---------------------------------------
// Server-side adapter that spawns Claude (subscription-only) to generate
// a RenderableDesign from the Step 5 design-app prompt.
export { ClaudeDesignAdapter, buildClaudeDesignPrompt } from './claude-design-adapter.js';
export type { ClaudeDesignAdapterDeps } from './claude-design-adapter.js';
