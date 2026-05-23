/**
 * Atlas-mapper structured errors.
 *
 * The package is pure logic — every failure mode is predictable and
 * carries a stable `code` so downstream surfaces (Atlas parent shell,
 * step-5 adapter framework) can map them to user-facing messages without
 * parsing free-form strings.
 */

export type AtlasMapperErrorCode =
  | 'cycle_detected'
  | 'duplicate_dom_id'
  | 'missing_dom_id'
  | 'invalid_renderable_design'
  | 'invalid_ticket_tree'
  | 'duplicate_ticket_binding'
  | 'unknown_component_tree'
  | 'jsx_parse_error';

/**
 * Base error class for all atlas-mapper failures.
 *
 * `code` is the stable enum; `context` carries structured details
 * (e.g. which DOM-ID was duplicated). Code values exhaustively cover
 * the failure surface so callers can switch on them.
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
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AtlasMapperError);
    }
  }
}
