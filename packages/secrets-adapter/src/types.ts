/**
 * @caia/secrets-adapter — public types.
 *
 * Reference: research/multi_tenant_secrets_architecture_2026.md §6.
 */

import { z } from 'zod';

export const CALLER_TYPES = [
  'agent',
  'user',
  'deploy-worker',
  'cron',
  'system',
] as const;

export const CallerTypeSchema = z.enum(CALLER_TYPES);
export type CallerType = z.infer<typeof CallerTypeSchema>;

/**
 * Mandatory caller envelope. Passed on every `get` so the adapter — not the
 * caller — writes the audit row. There is no anonymous read.
 *
 * `requesterIp` is populated by the broker at its boundary, NOT by the
 * caller, so a malicious agent can't lie about its origin.
 *
 * `capabilityTokenId` joins the secrets-broker ledger to the
 * capability-broker ledger so an operator can trace "what credential was
 * fetched for what action".
 */
export const AccessContextSchema = z.object({
  callerType: CallerTypeSchema,
  callerId: z.string().min(1).max(200),
  ticketId: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(500),
  capabilityTokenId: z.string().min(8).max(200).optional(),
  requesterIp: z.string().min(1).max(45).optional(),
});
export type AccessContext = z.infer<typeof AccessContextSchema>;

export const SecretMetadataSchema = z.object({
  key: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  secretRef: z.string().min(1).max(500),
  createdAt: z.date(),
  lastAccessedAt: z.date().optional(),
  lastRotatedAt: z.date().optional(),
  version: z.number().int().nonnegative().optional(),
  expiresAt: z.date().optional(),
});
export type SecretMetadata = z.infer<typeof SecretMetadataSchema>;

export const ERROR_CLASSES = [
  'not_found',
  'policy_denied',
  'rate_limited',
  'provider_error',
] as const;

export const ErrorClassSchema = z.enum(ERROR_CLASSES);
export type ErrorClass = z.infer<typeof ErrorClassSchema>;

export const AccessLogEntrySchema = z.object({
  tenantId: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
  callerType: CallerTypeSchema,
  callerId: z.string().min(1).max(200),
  ticketId: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(500),
  capabilityTokenId: z.string().min(8).max(200).optional(),
  requesterIp: z.string().min(1).max(45).optional(),
  grantedAt: z.date(),
  ok: z.boolean(),
  errorClass: ErrorClassSchema.optional(),
  providerTrace: z.string().min(1).max(500).optional(),
});
export type AccessLogEntry = z.infer<typeof AccessLogEntrySchema>;

export const PutOptionsSchema = z.object({
  ttlSeconds: z.number().int().positive().max(60 * 60 * 24 * 365).optional(),
  replace: z.boolean().optional(),
});
export type PutOptions = z.infer<typeof PutOptionsSchema>;

export const DeleteOptionsSchema = z.object({
  purge: z.boolean().optional(),
});
export type DeleteOptions = z.infer<typeof DeleteOptionsSchema>;

export const DeleteAllForTenantOptionsSchema = z.object({
  dryRun: z.boolean().optional(),
});
export type DeleteAllForTenantOptions = z.infer<
  typeof DeleteAllForTenantOptionsSchema
>;

export const PutResultSchema = z.object({
  secretRef: z.string().min(1).max(500),
  version: z.number().int().nonnegative().optional(),
});
export type PutResult = z.infer<typeof PutResultSchema>;

export const RotateResultSchema = z.object({
  rotatedAt: z.date(),
  version: z.number().int().nonnegative(),
});
export type RotateResult = z.infer<typeof RotateResultSchema>;

export const DeleteAllResultSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
  tenantTombstoneRef: z.string().min(1).max(500),
});
export type DeleteAllResult = z.infer<typeof DeleteAllResultSchema>;

export const PingResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().nonnegative(),
  backend: z.string().min(1).max(100),
});
export type PingResult = z.infer<typeof PingResultSchema>;

export const TenantIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, {
    message:
      'tenantId must be lowercase alphanumeric / hyphen, starting with a letter or digit',
  });

export const CategorySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, {
    message:
      'category must be lowercase alphanumeric / dot / underscore / hyphen',
  });

export const KeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message:
      'key must be alphanumeric / dot / underscore / hyphen, starting with an alphanumeric',
  });

export const SecretValueSchema = z.string().min(1).max(1024 * 1024);
