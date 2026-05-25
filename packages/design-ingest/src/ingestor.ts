/**
 * `Ingestor` — orchestrates validate → parse → snapshot for one upload.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §3 + §5.
 *
 * Lifecycle managed:
 *
 *   1. Caller resolves the adapter (`getDesignAdapterForTenant`) and
 *      hands it to `Ingestor.ingest(adapter, input, opts)`.
 *   2. Ingestor flips the `ux_uploads` row from `uploading` to
 *      `parsing`.
 *   3. Calls `adapter.validate(input)` (cheap, < 5 s). Validation
 *      errors short-circuit straight to `failed`.
 *   4. Calls `adapter.parse(input)` with a wall-clock timeout (default
 *      60 s). On timeout, sets `failed` with `parse_timeout`.
 *   5. Runs the result through `assertRenderableDesign` (Zod) — defends
 *      against malformed adapter output.
 *   6. Runs `finalizeDomIds` so every node has a stable DOM-ID.
 *   7. Calls `snapshotter.captureSnapshot(uxUploadId, design, { notes })`
 *      which writes the `design_versions` row + dedups asset blobs.
 *   8. Marks the `ux_uploads` row `parsed` with the parse duration.
 *
 * Idempotency: re-running with `skipSnapshotIfUnchanged: true` and a
 * hash-stable parse will short-circuit at step 7.
 *
 * No LLM calls. No network beyond what the adapter + snapshotter do.
 */

import type { ZodError } from 'zod';
import type { RenderableDesign } from './schema.js';
import {
  assertRenderableDesign,
  RenderableDesignSchema,
} from './schema.js';
import type {
  AdapterInput,
  DesignAdapter,
  IngestOptions,
  IngestResult,
  InsertUxUploadInput,
  ValidationResult,
} from './types.js';
import type { UxUploadsRepo } from './persistence.js';
import { finalizeDomIds } from './dom-id.js';
import { DesignIngestError, IngestionError } from './errors.js';
import type { DesignSnapshotter } from '@caia/atlas-design-snapshotter';

export interface IngestorDeps {
  uxUploads: UxUploadsRepo;
  snapshotter: DesignSnapshotter;
  /** Test-injectable clock. Defaults to `Date.now`. */
  now?: () => number;
}

const DEFAULT_PARSE_TIMEOUT_MS = 60_000;

export class Ingestor {
  private readonly uxUploads: UxUploadsRepo;
  private readonly snapshotter: DesignSnapshotter;
  private readonly now: () => number;

  constructor(deps: IngestorDeps) {
    this.uxUploads = deps.uxUploads;
    this.snapshotter = deps.snapshotter;
    this.now = deps.now ?? ((): number => Date.now());
  }

  /**
   * Create a new `ux_uploads` row in status `uploading`. Returns the
   * row id so the caller can stash the uploaded bytes against it. The
   * caller then calls `ingest()` once bytes are in storage.
   */
  async createUpload(input: InsertUxUploadInput): Promise<string> {
    const row = await this.uxUploads.insert(input);
    return row.id;
  }

  /**
   * Run the full pipeline. Mutates the `ux_uploads` row to its terminal
   * status (`parsed` or `failed`) and, on success, captures a snapshot.
   */
  async ingest(
    uxUploadId: string,
    adapter: DesignAdapter,
    input: AdapterInput,
    opts: IngestOptions = {},
  ): Promise<IngestResult> {
    const startedAt = this.now();
    await this.uxUploads.markParsing(uxUploadId);

    // 1. validate
    let validation: ValidationResult;
    try {
      validation = await adapter.validate(input);
    } catch (err) {
      const ms = this.now() - startedAt;
      const reason = err instanceof Error ? err.message : String(err);
      await this.uxUploads.markFailed(uxUploadId, `validate threw: ${reason}`, ms, null);
      throw new IngestionError(`adapter.validate threw: ${reason}`, { uxUploadId }, err);
    }
    if (!validation.ok) {
      const ms = this.now() - startedAt;
      const reason =
        validation.errors[0]?.message ?? `validation failed (no error details)`;
      await this.uxUploads.markFailed(uxUploadId, reason, ms, {
        warnings: validation.warnings,
        errors: validation.errors,
      });
      throw new IngestionError(`adapter.validate rejected input: ${reason}`, {
        uxUploadId,
        warnings: validation.warnings,
        errors: validation.errors,
      });
    }

    // 2. parse with timeout
    let parsed: RenderableDesign;
    const parseTimeoutMs = opts.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
    try {
      parsed = await runWithTimeout(adapter.parse(input), parseTimeoutMs);
    } catch (err) {
      const ms = this.now() - startedAt;
      const isTimeout = err instanceof DesignIngestError && err.code === 'parse_timeout';
      const reason = isTimeout
        ? `parse timed out after ${parseTimeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      await this.uxUploads.markFailed(uxUploadId, reason, ms, {
        warnings: validation.warnings,
        cause: errString(err),
      });
      throw new IngestionError(`adapter.parse failed: ${reason}`, { uxUploadId }, err);
    }

    // 3. validate Renderable shape
    try {
      assertRenderableDesign(parsed);
    } catch (err) {
      const ms = this.now() - startedAt;
      const reason = `adapter.parse returned malformed RenderableDesign: ${zodMessage(err)}`;
      await this.uxUploads.markFailed(uxUploadId, reason, ms, {
        warnings: validation.warnings,
        cause: errString(err),
      });
      throw new IngestionError(reason, { uxUploadId }, err);
    }

    // 4. finalize DOM IDs
    let finalized: RenderableDesign;
    try {
      finalized = finalizeDomIds(parsed);
    } catch (err) {
      const ms = this.now() - startedAt;
      const reason = `assignStableDomIds threw: ${err instanceof Error ? err.message : String(err)}`;
      await this.uxUploads.markFailed(uxUploadId, reason, ms, {
        warnings: validation.warnings,
        cause: errString(err),
      });
      throw new IngestionError(reason, { uxUploadId }, err);
    }

    // 5. capture snapshot
    let version;
    try {
      const captureOpts: { notes?: string; skipIfUnchanged?: boolean } = {};
      if (opts.notes !== undefined) captureOpts.notes = opts.notes;
      if (opts.skipSnapshotIfUnchanged !== undefined) {
        captureOpts.skipIfUnchanged = opts.skipSnapshotIfUnchanged;
      }
      version = await this.snapshotter.captureSnapshot(
        uxUploadId,
        finalized,
        captureOpts,
      );
    } catch (err) {
      const ms = this.now() - startedAt;
      const reason = `snapshotter.captureSnapshot threw: ${err instanceof Error ? err.message : String(err)}`;
      await this.uxUploads.markFailed(uxUploadId, reason, ms, {
        warnings: validation.warnings,
        cause: errString(err),
      });
      throw new IngestionError(reason, { uxUploadId }, err);
    }

    // 6. mark parsed
    const parseDurationMs = this.now() - startedAt;
    await this.uxUploads.markParsed(uxUploadId, finalized, parseDurationMs, {
      warnings: validation.warnings,
    });

    return {
      uxUploadId,
      designVersionId: version.id,
      versionNumber: version.versionNumber,
      status: 'parsed',
      parseDurationMs,
      warnings: validation.warnings,
    };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        new DesignIngestError(
          'parse_timeout',
          `parse exceeded ${ms}ms`,
          { timeoutMs: ms },
        ),
      );
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

function errString(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

function zodMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as ZodError).issues;
    return issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
  }
  return errString(err);
}

// Re-export the schema so this module can serve as a one-stop import.
export { RenderableDesignSchema };
