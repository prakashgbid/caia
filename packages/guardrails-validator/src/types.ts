/**
 * @chiefaia/guardrails-validator — public type surface.
 */

export type ProfileName =
  | 'untrusted-user-input'
  | 'inter-agent'
  | 'pre-publish'
  | 'tool-call-args'
  | 'none';

/** Worst-case action across all flags in a single ValidationResult. */
export type GuardAction = 'pass' | 'flag' | 'redact' | 'reject';

export interface ValidationFlag {
  /** Stable identifier, e.g. 'pii.email', 'secret.aws-access-key', 'injection.ignore-previous'. */
  guardId: string;
  description: string;
  action: 'flagged' | 'redacted' | 'rejected';
  matchCount: number;
  /**
   * Sample matches, capped to first 3.
   * Omitted when action === 'redacted' (raw secret would re-leak via the audit log).
   * For 'flagged' PII / secret patterns, matches are partially masked.
   */
  matches?: string[];
}

export interface ValidationResult {
  /** Possibly redacted payload safe to forward downstream. */
  payload: string;
  flags: ValidationFlag[];
  /** Worst-case action across all flags. */
  action: GuardAction;
  /** True iff `action === 'reject'`. */
  rejected: boolean;
  /** Profile that was applied. */
  profile: ProfileName;
  /** Wall-clock duration of the validation in milliseconds. */
  durationMs: number;
}

export interface NamedPattern {
  id: string;
  description: string;
  re: RegExp;
}

export interface ValidationEvent {
  profile: ProfileName;
  direction: 'input' | 'output';
  action: GuardAction;
  flagCount: number;
  guardIds: string[];
  payloadChars: number;
  durationMs: number;
  rejected: boolean;
}

export interface GuardrailsValidatorConfig {
  /** System-prompt text to compare outputs against for leakageGuard. Default ''. */
  systemPromptCorpus?: string;
  /** Additional injection regex patterns merged with the catalogue. */
  customInjectionPatterns?: readonly NamedPattern[];
  /** Additional PII patterns. */
  customPiiPatterns?: readonly NamedPattern[];
  /** Additional secret patterns. */
  customSecretPatterns?: readonly NamedPattern[];
  /** Strictness thresholds for injection scoring. Defaults: paranoid 0.6, lenient 0.85. */
  injectionThresholds?: { paranoid: number; lenient: number };
  /** Cosine-similarity threshold for leakage guard. Default 0.6. */
  leakageThreshold?: number;
  /** Skip RFC1918 / loopback IPv4 ranges in piiGuard. Default true. */
  ipv4SkipPrivateRanges?: boolean;
  /** Min chars in a high-entropy slice before secretGuard considers it. Default 32. */
  secretMinEntropyChars?: number;
  /** Shannon-entropy threshold for high-entropy secret detection. Default 4.5. */
  secretEntropyThreshold?: number;
  /**
   * Telemetry sink. Called once per validate{Input,Output} invocation with the
   * final ValidationEvent. Errors thrown here are swallowed.
   */
  onValidationEvent?: (event: ValidationEvent) => void;
}
