/**
 * @chiefaia/hmac-auth — shared HMAC-SHA256 primitives and timestamped
 * request signing.
 */

export {
  DEFAULT_REPLAY_WINDOW_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  hmacSign,
  hmacSignHex,
  signRequest,
} from './sign.js';

export {
  hmacVerify,
  verifyRequest,
  type VerifyRequestResult,
} from './verify.js';

export { MIN_SECRET_LENGTH, loadSecret } from './secret.js';

/**
 * Backwards-compatibility alias for the result type previously exported
 * as `VerifyResult` by `@chiefaia/mentor-event-bus`. New code should
 * prefer `VerifyRequestResult` from this package.
 */
export type { VerifyRequestResult as VerifyResult } from './verify.js';
