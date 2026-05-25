/**
 * Structured errors for `@caia/design-ingest`.
 *
 * Every failure mode carries a stable `code` so callers (HTTP upload
 * endpoint, downstream Atlas, Step 4 → Step 5 converter) can branch
 * on the enum without parsing free-form messages.
 */

export type DesignIngestErrorCode =
  | 'provider_not_supported'
  | 'refresh_not_supported'
  | 'not_implemented'
  | 'ux_upload_not_found'
  | 'tenant_not_found'
  | 'adapter_already_registered'
  | 'parse_timeout'
  | 'invalid_renderable_design'
  | 'ingestion_failed'
  | 'gdpr_partial_failure';

export class DesignIngestError extends Error {
  public readonly code: DesignIngestErrorCode;
  public readonly context: Record<string, unknown>;
  public override readonly cause?: unknown;

  constructor(
    code: DesignIngestErrorCode,
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message);
    this.name = 'DesignIngestError';
    this.code = code;
    this.context = context;
    if (cause !== undefined) this.cause = cause;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, DesignIngestError);
    }
  }
}

/**
 * Thrown by `getDesignAdapterForTenant` when the tenant's
 * `preferred_design_source` row points at a source string that the
 * registry doesn't know about.
 *
 * Distinct from `RefreshNotSupported`: this means *no* adapter exists
 * for the source; `RefreshNotSupported` means the adapter exists but
 * is upload-only.
 */
export class ProviderNotSupported extends DesignIngestError {
  constructor(source: string, context: Record<string, unknown> = {}) {
    super(
      'provider_not_supported',
      `design source ${source} is not registered in DESIGN_ADAPTER_REGISTRY`,
      { source, ...context },
    );
    this.name = 'ProviderNotSupported';
  }
}

/**
 * Thrown by adapters whose source is upload-only (CD ZIP, Bolt,
 * Framer export, Anima export). Spec §3 explicitly requires this
 * sentinel so onboarding UX can grey out the "re-pull" button.
 */
export class RefreshNotSupported extends DesignIngestError {
  constructor(sourceName: string, context: Record<string, unknown> = {}) {
    super(
      'refresh_not_supported',
      `source ${sourceName} is upload-only and does not support refresh()`,
      { sourceName, ...context },
    );
    this.name = 'RefreshNotSupported';
  }
}

/**
 * Thrown by stub adapter implementations in this PR (the CD ZIP
 * adapter ships as scaffold-only — its `parse` throws this).
 * Downstream test harness asserts on this code.
 */
export class NotImplementedError extends DesignIngestError {
  constructor(what: string, context: Record<string, unknown> = {}) {
    super('not_implemented', `${what} is not implemented yet`, { what, ...context });
    this.name = 'NotImplementedError';
  }
}

/**
 * Thrown by `Ingestor.ingest()` when the parse step fails. Wraps the
 * underlying adapter error as `cause`.
 */
export class IngestionError extends DesignIngestError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super('ingestion_failed', message, context, cause);
    this.name = 'IngestionError';
  }
}
