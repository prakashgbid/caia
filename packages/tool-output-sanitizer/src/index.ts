/**
 * @chiefaia/tool-output-sanitizer — public surface.
 */

export {
  sanitizeToolResult,
  sanitizeMcpToolResult,
  type SanitizeOptions,
  type SanitizedResult,
  type Strictness,
} from './sanitizer.js';
export {
  PARANOID_PATTERNS,
  LENIENT_PATTERNS,
  patternsForStrictness,
  type SanitizerAction,
  type SanitizerPattern,
} from './patterns.js';
