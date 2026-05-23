/**
 * Atlas-mapper structured errors.
 *
 * The package is pure logic — all failure modes are predictable and have
 * a deterministic error code so downstream surfaces (the Atlas parent
 * shell, the step-5 adapter framework) can map them to user-facing
 * messages without parsing free-form strings.
 */

export type AtlasMapperErrorCode =
  | 'cycle_detected'
  | 'duplicate_dom_id'
  | 'missing_dom_id'
  | 'invalid_renderable_design'
  | 'invalid_ticket_tree'
  | 'unknown_component_tree';

/**
 * Base error class for all atlas-mapper failures.
 *
 * Carries a stable `code` field plus optional `context` (e.g. which DOM-ID
 * was duplicated). Code values are an exhaustive enum so callers can switch
 * on them.
 */
export class AtlasMapperError extends Error {
  public readonly code: AtlasMapperErrorCode;
  public readonly context: Record<string, unknown>;

  constructor(
    code: AtlasMapperErrorCode,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AtlasMapperError';
    this.code = code;
    this.context = context;
    // Preserve V8 stack trace cleanly.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AtlasMapperError);
    }
  }
}
