/**
 * `@caia/onboarding` — public types.
 *
 * Reference: research/step1_onboarding_spec_2026.md §1, §2, §5.
 */

import { z } from 'zod';

// ============================================================
// Archetypes — the 5 validator archetypes from §2.
// ============================================================
export const ARCHETYPES = [
  'oauth',
  'api_token',
  'dns',
  'webhook',
  'endpoint',
] as const;
export const ArchetypeSchema = z.enum(ARCHETYPES);
export type Archetype = z.infer<typeof ArchetypeSchema>;

// ============================================================
// Step status — see migration 0001_caia_meta_init.sql.
// ============================================================
export const STEP_STATUSES = [
  'pending',
  'probing',
  'passed',
  'failed',
  'deferred',
] as const;
export const StepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof StepStatusSchema>;

// ============================================================
// Provider modes from §1.
// ============================================================
export const PROVIDER_MODES = [
  'self_hosted',
  'byo',
  'caia_managed',
  'none',
] as const;
export const ProviderModeSchema = z.enum(PROVIDER_MODES);
export type ProviderMode = z.infer<typeof ProviderModeSchema>;

// ============================================================
// Category — one per slot in the 15 mandatory + 4 optional list.
// ============================================================
export const CATEGORY_IDS = [
  // 15 mandatory
  'identity',
  'auth',
  'pricing',
  'repo',
  'ci',
  'cloud',
  'domain',
  'dns',
  'cdn',
  'database',
  'email',
  'analytics',
  'errors',
  'observability',
  'pm',
  // 4 optional
  'docs',
  'design',
  'compliance',
  'anthropic_prefs',
] as const;
export const CategoryIdSchema = z.enum(CATEGORY_IDS);
export type CategoryId = z.infer<typeof CategoryIdSchema>;

export const MANDATORY_CATEGORY_IDS: readonly CategoryId[] = [
  'identity',
  'auth',
  'pricing',
  'repo',
  'ci',
  'cloud',
  'domain',
  'dns',
  'cdn',
  'database',
  'email',
  'analytics',
  'errors',
  'observability',
  'pm',
];
export const OPTIONAL_CATEGORY_IDS: readonly CategoryId[] = [
  'docs',
  'design',
  'compliance',
  'anthropic_prefs',
];

// ============================================================
// Credential descriptor — what the engine stores per slot.
// ============================================================
export const CredentialDescriptorSchema = z.object({
  keyId: z.string().min(1).max(200),
  archetype: ArchetypeSchema,
  scopesRequired: z.array(z.string()).default([]),
  /** Whether the credential goes into Infisical (true) or stays as a
   *  validated-and-discarded probe (false — e.g. DNS proof of control). */
  storeSecret: z.boolean().default(true),
});
export type CredentialDescriptor = z.infer<typeof CredentialDescriptorSchema>;

// ============================================================
// Provider option — one row in a category's provider dropdown.
// ============================================================
export const ProviderOptionSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  archetype: ArchetypeSchema,
  credentialDescriptors: z.array(CredentialDescriptorSchema).default([]),
  /** Free-form provider metadata that the validator inspects. */
  metadata: z.record(z.unknown()).default({}),
  /** When true, this option requires no credentials at all (e.g. "none"
   *  or "caia-managed") — the wizard renders it but skips the validator. */
  noCredentials: z.boolean().default(false),
});
export type ProviderOption = z.infer<typeof ProviderOptionSchema>;

// ============================================================
// Category definition — the static description of one wizard step.
// ============================================================
export const CategoryDefinitionSchema = z.object({
  id: CategoryIdSchema,
  label: z.string().min(1).max(200),
  ordinal: z.number().int().min(1).max(50),
  required: z.boolean(),
  description: z.string().min(1).max(800),
  /** Provider options the customer can pick from. */
  providers: z.array(ProviderOptionSchema),
});
export type CategoryDefinition = z.infer<typeof CategoryDefinitionSchema>;

// ============================================================
// Persistence rows mirroring caia_meta.* tables.
// ============================================================
export const TenantRowSchema = z.object({
  id: z.string().min(1).max(200),
  slug: z.string().min(1).max(200),
  name: z.string().min(1).max(400),
  ownerEmail: z.string().email(),
  billingEmail: z.string().email(),
  timezone: z.string().min(1).max(80),
  locale: z.string().min(1).max(20),
  status: z.enum([
    'created',
    'onboarding',
    'onboarded',
    'suspended',
    'deleted',
  ]),
  onboardingComplete: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TenantRow = z.infer<typeof TenantRowSchema>;

export const OnboardingStepRowSchema = z.object({
  tenantId: z.string().min(1),
  category: CategoryIdSchema,
  status: StepStatusSchema,
  required: z.boolean(),
  attemptCount: z.number().int().nonnegative(),
  lastProbeAt: z.date().optional(),
  lastValidatedAt: z.date().optional(),
  validationPayload: z.record(z.unknown()).optional(),
  failureReason: z.string().optional(),
  deferredReason: z.string().optional(),
  overrideReason: z.string().optional(),
});
export type OnboardingStepRow = z.infer<typeof OnboardingStepRowSchema>;

export const CustomerChoiceRowSchema = z.object({
  tenantId: z.string().min(1),
  category: CategoryIdSchema,
  choiceKey: z.string().min(1),
  choiceValue: z.unknown(),
  source: z.enum(['wizard', 'cli', 'operator_override', 'default']),
});
export type CustomerChoiceRow = z.infer<typeof CustomerChoiceRowSchema>;

export const CredentialRowSchema = z.object({
  tenantId: z.string().min(1),
  category: CategoryIdSchema,
  keyId: z.string().min(1),
  secretRef: z.string().min(1),
  archetype: ArchetypeSchema,
  provider: z.string().min(1),
  scopesGranted: z.array(z.string()).default([]),
  scopesRequired: z.array(z.string()).default([]),
  expiresAt: z.date().optional(),
  status: z.enum(['active', 'rotating', 'deprecated', 'revoked']),
  validatedAt: z.date(),
  metadata: z.record(z.unknown()).default({}),
});
export type CredentialRow = z.infer<typeof CredentialRowSchema>;

export const AuditLogEntrySchema = z.object({
  tenantId: z.string().min(1),
  actorType: z.enum(['customer', 'operator', 'agent', 'system']),
  actorId: z.string().optional(),
  action: z.string().min(1).regex(/^[a-z_.]+$/),
  category: CategoryIdSchema.optional(),
  keyId: z.string().optional(),
  requestIp: z.string().optional(),
  userAgent: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
  occurredAt: z.date().default(() => new Date()),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// ============================================================
// Validator input/output — what the wizard server hands to the
// engine and what the engine hands back.
// ============================================================
export const ValidatorInputSchema = z.object({
  tenantId: z.string().min(1),
  category: CategoryIdSchema,
  providerId: z.string().min(1),
  /** Choices the customer made on this category screen. */
  choices: z.record(z.unknown()).default({}),
  /** Raw credential values, keyed by `keyId`. These are passed straight
   *  to the validator and never persisted in plaintext. */
  credentials: z.record(z.string()).default({}),
});
export type ValidatorInput = z.infer<typeof ValidatorInputSchema>;

export const ValidatorSuccessSchema = z.object({
  ok: z.literal(true),
  providerId: z.string().min(1),
  archetype: ArchetypeSchema,
  scopesGranted: z.array(z.string()).default([]),
  /** Provider-specific extras (account id, org id, etc.). */
  metadata: z.record(z.unknown()).default({}),
});
export type ValidatorSuccess = z.infer<typeof ValidatorSuccessSchema>;

export const ValidatorFailureSchema = z.object({
  ok: z.literal(false),
  providerId: z.string().min(1),
  errorCode: z.enum([
    'scope_insufficient',
    'token_invalid',
    'token_expired',
    'network_error',
    'rate_limited',
    'provider_error',
    'choice_invalid',
  ]),
  message: z.string().min(1),
  retryHint: z.string().optional(),
});
export type ValidatorFailure = z.infer<typeof ValidatorFailureSchema>;

export const ValidatorResultSchema = z.discriminatedUnion('ok', [
  ValidatorSuccessSchema,
  ValidatorFailureSchema,
]);
export type ValidatorResult = z.infer<typeof ValidatorResultSchema>;

// ============================================================
// Validator strategy — one function per (category, provider).
// ============================================================
export type Validator = (
  input: ValidatorInput,
  ctx: ValidatorContext,
) => Promise<ValidatorResult>;

export interface ValidatorContext {
  /** Injected fetch — tests pass a mock. */
  fetch: typeof fetch;
  /** Current wall-clock time — tests can fix this. */
  now: () => Date;
}
