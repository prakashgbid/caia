/**
 * `@caia/design-ingest` — public types.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §3.
 *
 * This file declares the `DesignAdapter` contract that every external
 * design source implements (CD ZIP, Figma JSON, v0, Lovable, Bolt,
 * Builder.io, Webflow, Framer, Anima). The framework dispatches via
 * `DESIGN_ADAPTER_REGISTRY[source]` and orchestrates
 * validate → parse → snapshot through `Ingestor.ingest()`.
 */

import type { RenderableDesign, SourceName } from './schema.js';
import type { PoolLike } from './pg-types.js';
import type { SecretsAdapter, AccessContext } from '@caia/secrets-adapter';
import type {
  BYOCBlobAdapter,
  DesignSnapshotter,
} from '@caia/atlas-design-snapshotter';

/**
 * Input handed to every `DesignAdapter.validate / parse / refresh` call.
 *
 * Two variants:
 *   - `upload` — a prior `POST /api/ingest/upload` stashed bytes in
 *     tenant blob storage under `uploadId`.
 *   - `remote` — a live source (Figma, Webflow, Builder.io).
 */
export type AdapterInput =
  | { kind: 'upload'; uploadId: string; tenantId: string }
  | {
      kind: 'remote';
      tenantId: string;
      sourceConfig: Record<string, unknown>;
    };

/** Severity tier — mirrors the `p0|p1|p2|p3` taxonomy used elsewhere. */
export type ValidationSeverity = 'p0' | 'p1' | 'p2' | 'p3';

/** Adapter-level validation outcome. */
export interface ValidationResult {
  ok: boolean;
  warnings: Array<{
    code: string;
    severity: ValidationSeverity;
    message: string;
  }>;
  errors: Array<{ code: string; message: string }>;
}

/** Adapter capabilities — drives onboarding UX. Spec §3. */
export interface AdapterCapabilities {
  supportsRefresh: boolean;
  supportsLiveWebhook: boolean;
  requiresCredential: boolean;
  credentialKind?: 'oauth' | 'api-token' | 'personal-access-token';
}

/**
 * Dependencies the framework hands every adapter at construction time.
 * Spec §3.1: `{ secrets, storage, pg }` — we carry the snapshotter
 * alongside so adapters can fetch prior versions for delta-parse.
 *
 * `accessContext` is the per-invocation envelope so the secrets-broker
 * writes the audit row with caller identity.
 */
export interface AdapterDeps {
  secrets: SecretsAdapter;
  storage: BYOCBlobAdapter;
  pg: PoolLike;
  snapshotter: DesignSnapshotter;
  accessContext: AccessContext;
}

/**
 * The contract every external source implements. Spec §3 verbatim.
 *
 * Adapters are pure factories of `RenderableDesign`. They do NOT write
 * to `ux_uploads` / `design_versions` directly — the framework does
 * that around them via `Ingestor.ingest()`.
 */
export interface DesignAdapter {
  readonly sourceName: SourceName;
  validate(input: AdapterInput): Promise<ValidationResult>;
  parse(input: AdapterInput): Promise<RenderableDesign>;
  refresh(designVersionId: string): Promise<RenderableDesign>;
  readonly capabilities: AdapterCapabilities;
}

/** Adapter constructor signature. */
export type DesignAdapterCtor = new (deps: AdapterDeps) => DesignAdapter;

// ---------------------------------------------------------------------------
// Persistence row shapes (ux_uploads — spec §4)
// ---------------------------------------------------------------------------

export type UxUploadStatus = 'uploading' | 'parsing' | 'parsed' | 'failed';

export interface UxUploadRow {
  id: string;
  tenantId: string;
  businessProposalId: string | null;
  source: SourceName;
  sourceMetadata: Record<string, unknown>;
  uploadedAt: Date;
  renderedDesign: RenderableDesign | null;
  status: UxUploadStatus;
  parseDiagnostics: Record<string, unknown> | null;
  parseDurationMs: number | null;
  failureReason: string | null;
}

export interface InsertUxUploadInput {
  tenantId: string;
  businessProposalId?: string | null;
  source: SourceName;
  sourceMetadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ingestor
// ---------------------------------------------------------------------------

export interface IngestOptions {
  /** Parse timeout in ms. Default 60_000 (absorbs spec §8 p95 + headroom). */
  parseTimeoutMs?: number;
  /** Passed through to `snapshotter.captureSnapshot(..., { notes })`. */
  notes?: string;
  /** When true, the snapshotter short-circuits on identical content. */
  skipSnapshotIfUnchanged?: boolean;
}

export interface IngestResult {
  uxUploadId: string;
  designVersionId: string;
  versionNumber: number;
  status: UxUploadStatus;
  parseDurationMs: number;
  warnings: ValidationResult['warnings'];
}

// ---------------------------------------------------------------------------
// GDPR
// ---------------------------------------------------------------------------

export interface DeleteAllForTenantOptions {
  dryRun?: boolean;
}

/**
 * Composite tombstone — each of the three sub-steps reports
 * independently. `failures[]` enumerates errored steps so the caller
 * can re-run just the failed surface.
 */
export interface DeleteAllForTenantResult {
  tenantId: string;
  snapshotter: {
    deletedVersionCount: number;
    deletedAssetCount: number;
    deletedBlobCount: number;
    tenantTombstoneRef: string;
  } | null;
  uxUploads: {
    deletedCount: number;
  } | null;
  secrets: {
    deletedCount: number;
    tenantTombstoneRef: string;
  } | null;
  failures: Array<{
    step: 'snapshotter' | 'ux_uploads' | 'secrets';
    error: string;
  }>;
  completedAt: Date;
  dryRun: boolean;
}
