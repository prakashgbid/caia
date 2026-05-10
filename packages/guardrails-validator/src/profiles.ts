/**
 * Validator profiles — composed guard sets per call-site context.
 *
 * Profiles are parameterised by strictness via constructor-injected
 * thresholds; production injects CAIA defaults.
 */

import type { ProfileName } from './types.js';

export interface ProfileSpec {
  injection: { enabled: boolean; threshold: number; rejectAbove: number };
  pii: { enabled: boolean; action: 'redact' | 'flag' };
  secret: { enabled: boolean; action: 'redact' | 'flag' };
  leakage: { enabled: boolean };
  /** Schema guard is opt-in per validateOutput call; profile only marks compatibility. */
  schemaCompatible: boolean;
}

export interface ProfileThresholds {
  paranoid: number;
  lenient: number;
}

export const DEFAULT_THRESHOLDS: ProfileThresholds = {
  paranoid: 0.6,
  lenient: 0.85,
};

export function buildProfile(
  name: ProfileName,
  thresholds: ProfileThresholds = DEFAULT_THRESHOLDS,
): ProfileSpec {
  switch (name) {
    case 'untrusted-user-input':
      return {
        injection: { enabled: true, threshold: thresholds.paranoid, rejectAbove: 0.9 },
        pii: { enabled: true, action: 'redact' },
        secret: { enabled: true, action: 'redact' },
        leakage: { enabled: false },
        schemaCompatible: false,
      };
    case 'inter-agent':
      return {
        injection: { enabled: true, threshold: thresholds.lenient, rejectAbove: 0.99 },
        pii: { enabled: false, action: 'flag' },
        secret: { enabled: true, action: 'flag' },
        leakage: { enabled: false },
        schemaCompatible: false,
      };
    case 'pre-publish':
      return {
        injection: { enabled: false, threshold: 1, rejectAbove: 1 },
        pii: { enabled: true, action: 'redact' },
        secret: { enabled: true, action: 'redact' },
        leakage: { enabled: true },
        schemaCompatible: false,
      };
    case 'tool-call-args':
      return {
        injection: { enabled: true, threshold: thresholds.lenient, rejectAbove: 0.95 },
        pii: { enabled: false, action: 'flag' },
        secret: { enabled: true, action: 'flag' },
        leakage: { enabled: false },
        schemaCompatible: true,
      };
    case 'none':
      return {
        injection: { enabled: false, threshold: 1, rejectAbove: 1 },
        pii: { enabled: false, action: 'flag' },
        secret: { enabled: false, action: 'flag' },
        leakage: { enabled: false },
        schemaCompatible: true,
      };
  }
}
