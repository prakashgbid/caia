/**
 * GuardrailsValidator — top-level façade.
 *
 * Public surface:
 *  - `validateInput(prompt, profile)`     — pre-LLM check
 *  - `validateOutput(response, profile)`  — post-LLM check
 *  - `validateOutput(response, profile, { schema })` — opt-in schema variant
 *
 * Per the Option E shape (`agent_architecture_shape_2026-05-06.md`), every
 * CAIA-specific value is constructor-injected with a CAIA default. Tests
 * inject fixture corpora via the same parameters.
 *
 * Scan order is fixed: injection → secret → pii → leakage → schema. Secret
 * runs before pii so that secret tokens (which may contain digit runs that
 * would collide with the phone-number regex) are redacted out of payload
 * BEFORE the pii scan sees them.
 */

import type { ZodTypeAny } from 'zod';

import type {
  GuardAction,
  GuardrailsValidatorConfig,
  ProfileName,
  ValidationEvent,
  ValidationFlag,
  ValidationResult,
} from './types.js';
import { buildProfile, DEFAULT_THRESHOLDS } from './profiles.js';
import { scanInjection } from './guards/injection.js';
import { maskPii, scanPii } from './guards/pii.js';
import { maskSecret, scanSecret } from './guards/secret.js';
import { scanLeakage } from './guards/leakage.js';
import { scanSchema } from './guards/schema.js';

export interface ValidateOptions {
  /** Optional zod schema for `tool-call-args` / `none` profiles. */
  schema?: ZodTypeAny;
}

export class GuardrailsValidator {
  private readonly cfg: Required<Omit<GuardrailsValidatorConfig, 'onValidationEvent'>> & {
    onValidationEvent?: (event: ValidationEvent) => void;
  };

  constructor(cfg: GuardrailsValidatorConfig = {}) {
    this.cfg = {
      systemPromptCorpus: cfg.systemPromptCorpus ?? '',
      customInjectionPatterns: cfg.customInjectionPatterns ?? [],
      customPiiPatterns: cfg.customPiiPatterns ?? [],
      customSecretPatterns: cfg.customSecretPatterns ?? [],
      injectionThresholds: cfg.injectionThresholds ?? DEFAULT_THRESHOLDS,
      leakageThreshold: cfg.leakageThreshold ?? 0.6,
      ipv4SkipPrivateRanges: cfg.ipv4SkipPrivateRanges ?? true,
      secretMinEntropyChars: cfg.secretMinEntropyChars ?? 32,
      secretEntropyThreshold: cfg.secretEntropyThreshold ?? 4.5,
      ...(cfg.onValidationEvent ? { onValidationEvent: cfg.onValidationEvent } : {}),
    };
  }

  validateInput(
    prompt: string,
    profile: ProfileName,
    opts: ValidateOptions = {},
  ): ValidationResult {
    return this.validate(prompt, profile, 'input', opts);
  }

  validateOutput(
    response: string,
    profile: ProfileName,
    opts: ValidateOptions = {},
  ): ValidationResult {
    return this.validate(response, profile, 'output', opts);
  }

  private validate(
    text: string,
    profileName: ProfileName,
    direction: 'input' | 'output',
    opts: ValidateOptions,
  ): ValidationResult {
    const start = nowMs();
    const profile = buildProfile(profileName, this.cfg.injectionThresholds);
    const flags: ValidationFlag[] = [];
    let payload = text;

    if (profile.injection.enabled) {
      const r = scanInjection(payload, this.cfg.customInjectionPatterns);
      if (r.score >= profile.injection.threshold) {
        const isReject = r.score >= profile.injection.rejectAbove;
        for (const f of r.flags) {
          flags.push({
            guardId: f.id,
            description: f.description,
            action: isReject ? 'rejected' : 'flagged',
            matchCount: f.matchCount,
          });
        }
      }
    }

    // Secrets BEFORE PII: secret tokens may contain digit runs that would
    // otherwise be captured by the phone-number / SSN patterns.
    if (profile.secret.enabled) {
      const r = scanSecret(
        payload,
        this.cfg.customSecretPatterns,
        {
          minEntropyChars: this.cfg.secretMinEntropyChars,
          entropyThreshold: this.cfg.secretEntropyThreshold,
        },
      );
      for (const hit of r.hits) {
        if (profile.secret.action === 'redact') {
          for (const v of hit.values) {
            payload = replaceAll(payload, v, `[REDACTED:${hit.id}]`);
          }
          flags.push({
            guardId: hit.id,
            description: hit.description,
            action: 'redacted',
            matchCount: hit.values.length,
          });
        } else {
          flags.push({
            guardId: hit.id,
            description: hit.description,
            action: 'flagged',
            matchCount: hit.values.length,
            matches: hit.values.slice(0, 3).map(maskSecret),
          });
        }
      }
    }

    if (profile.pii.enabled) {
      const r = scanPii(payload, this.cfg.customPiiPatterns, {
        ipv4SkipPrivateRanges: this.cfg.ipv4SkipPrivateRanges,
      });
      for (const hit of r.hits) {
        if (profile.pii.action === 'redact') {
          for (const v of hit.values) {
            payload = replaceAll(payload, v, `[REDACTED:${hit.id}]`);
          }
          flags.push({
            guardId: hit.id,
            description: hit.description,
            action: 'redacted',
            matchCount: hit.values.length,
          });
        } else {
          flags.push({
            guardId: hit.id,
            description: hit.description,
            action: 'flagged',
            matchCount: hit.values.length,
            matches: hit.values.slice(0, 3).map(maskPii),
          });
        }
      }
    }

    if (profile.leakage.enabled && this.cfg.systemPromptCorpus) {
      const r = scanLeakage(payload, this.cfg.systemPromptCorpus, {
        threshold: this.cfg.leakageThreshold,
      });
      if (r.leaked) {
        flags.push({
          guardId: 'leakage.system-prompt',
          description: `System-prompt leakage detected (similarity=${r.similarity.toFixed(3)}, longest-overlap=${r.longestOverlap} tokens)`,
          action: 'flagged',
          matchCount: r.longestOverlap,
        });
      }
    }

    if (profile.schemaCompatible && opts.schema) {
      const r = scanSchema(payload, opts.schema);
      if (!r.ok) {
        flags.push({
          guardId: 'schema.zod',
          description: 'Output failed zod schema validation',
          action: 'rejected',
          matchCount: r.issues.length,
          matches: r.issues.slice(0, 3),
        });
      }
    }

    const action: GuardAction = computeWorstAction(flags);
    const rejected = action === 'reject';
    const durationMs = nowMs() - start;
    const result: ValidationResult = {
      payload,
      flags,
      action,
      rejected,
      profile: profileName,
      durationMs,
    };

    if (this.cfg.onValidationEvent) {
      try {
        this.cfg.onValidationEvent({
          profile: profileName,
          direction,
          action,
          flagCount: flags.length,
          guardIds: flags.map((f) => f.guardId),
          payloadChars: text.length,
          durationMs,
          rejected,
        });
      } catch {
        // swallow telemetry errors
      }
    }

    return result;
  }
}

function computeWorstAction(flags: readonly ValidationFlag[]): GuardAction {
  let worst: GuardAction = 'pass';
  const order: GuardAction[] = ['pass', 'flag', 'redact', 'reject'];
  const rank = (a: GuardAction): number => order.indexOf(a);
  for (const f of flags) {
    let mapped: GuardAction;
    if (f.action === 'rejected') mapped = 'reject';
    else if (f.action === 'redacted') mapped = 'redact';
    else mapped = 'flag';
    if (rank(mapped) > rank(worst)) worst = mapped;
  }
  return worst;
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  return haystack.split(needle).join(replacement);
}

function nowMs(): number {
  // Avoid importing perf_hooks for portability; Date.now is sufficient for ms precision.
  return Date.now();
}
