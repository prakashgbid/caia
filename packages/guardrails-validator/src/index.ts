/**
 * @chiefaia/guardrails-validator — public surface.
 *
 * Layer-2 input/output validation for agent LLM calls. See DESIGN.md for the
 * full design rationale, profile catalogue, and integration pattern.
 */

export { GuardrailsValidator, type ValidateOptions } from './validator.js';
export { buildProfile, DEFAULT_THRESHOLDS, type ProfileSpec, type ProfileThresholds } from './profiles.js';
export type {
  GuardAction,
  GuardrailsValidatorConfig,
  NamedPattern,
  ProfileName,
  ValidationEvent,
  ValidationFlag,
  ValidationResult,
} from './types.js';

// Lower-level guard exports — for callers that want to compose custom profiles.
export { BUILTIN_INJECTION_PATTERNS, scanInjection, type WeightedInjectionPattern } from './guards/injection.js';
export { BUILTIN_PII_PATTERNS, maskPii, scanPii, type PiiOptions, type PiiScanResult } from './guards/pii.js';
export { BUILTIN_SECRET_PATTERNS, maskSecret, scanSecret, type SecretOptions, type SecretScanResult } from './guards/secret.js';
export { scanLeakage, type LeakageOptions, type LeakageScanResult } from './guards/leakage.js';
export { scanSchema, type SchemaScanResult } from './guards/schema.js';
