/**
 * Structured errors for `@caia/atlas-design-snapshotter`.
 *
 * Every failure mode carries a stable `code` so callers (Atlas parent
 * shell, step-5 ingest pipeline, Architect #15 "UX Version Control")
 * can branch on the enum without parsing free-form messages.
 */

export type SnapshotterErrorCode =
  | 'tenant_schema_missing'
  | 'ux_upload_not_found'
  | 'design_version_not_found'
  | 'invalid_renderable_design'
  | 'invalid_version_number'
  | 'byoc_put_failed'
  | 'byoc_delete_failed'
  | 'asset_hash_mismatch'
  | 'concurrent_version_conflict';

export class SnapshotterError extends Error {
  public readonly code: SnapshotterErrorCode;
  public readonly context: Record<string, unknown>;

  constructor(
    code: SnapshotterErrorCode,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'SnapshotterError';
    this.code = code;
    this.context = context;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, SnapshotterError);
    }
  }
}
