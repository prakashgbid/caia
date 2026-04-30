/**
 * Capability broker types — Zod-validated schemas + inferred TS types.
 *
 * Reference: third-party-caia-paper-analysis-2026-04-29.md §C.1.
 */

import { z } from 'zod';

/**
 * Canonical capability names. New names go here; the broker rejects any
 * issuance request for an unknown name.
 */
export const CAPABILITY_NAMES = [
  // git
  'git.push.protected', // pushing to develop / main / release/*
  'git.push.force', // any --force or --force-with-lease push
  // GitHub
  'gh.pr.merge', // merging a PR (squash/merge/rebase)
  'gh.repo.delete', // deleting / archiving a repo
  // npm / pnpm publishing
  'npm.publish',
  // Cloudflare
  'cloudflare.api', // calls to api.cloudflare.com
  'cloudflare.pages.deploy.preview',
  'cloudflare.pages.deploy.production',
  // Supabase
  'supabase.admin', // any DDL or service-key call
  'supabase.db.reset',
  // Generic deploy
  'deploy.production',
  // File-system irreversible actions outside the worktree
  'fs.delete.outside.worktree',
] as const;

export const CapabilityNameSchema = z.enum(CAPABILITY_NAMES);
export type CapabilityName = z.infer<typeof CapabilityNameSchema>;

/**
 * Static description of a capability (no runtime state).
 *
 * `scope` constrains the resource the action may touch. For
 * `cloudflare.api` it is the API endpoint pattern; for `git.push.protected`
 * it is the protected ref pattern; for `npm.publish` it is the package name.
 */
export const CapabilitySchema = z.object({
  name: CapabilityNameSchema,
  description: z.string().min(3),
  scope: z.string().min(1),
  /** Token TTL in milliseconds. Defaults to 5 minutes. */
  ttlMs: z.number().int().positive().max(60 * 60 * 1000).default(5 * 60 * 1000),
  /** Owner agent role (e.g. "coding-agent", "fix-it-agent", "release-bot"). */
  owner: z.string().min(1),
  /** True if the action is irreversible and must hit the ledger. */
  irreversible: z.boolean().default(true),
});
export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * Issuance allowlist entry. The broker rejects an issuance request unless
 * (capability.name, agent role, scope) matches at least one allowlist entry.
 */
export const CapabilityAllowlistEntrySchema = z.object({
  name: CapabilityNameSchema,
  /** Agent role allowed to request this capability. */
  agentRole: z.string().min(1),
  /** Glob-style pattern the requested scope must match. `*` = any. */
  scopePattern: z.string().min(1),
  /** Optional max calls per task. */
  maxPerTask: z.number().int().positive().optional(),
});
export type CapabilityAllowlistEntry = z.infer<
  typeof CapabilityAllowlistEntrySchema
>;

/**
 * Issued capability token. Short-lived. Single-use unless `singleUse=false`.
 *
 * The token's signature binds together name + scope + taskId + nonce so a
 * leaked token can't be replayed against a different scope.
 */
export const CapabilityTokenSchema = z.object({
  /** Token id (random nonce, 16 bytes hex). */
  tokenId: z.string().min(16),
  name: CapabilityNameSchema,
  scope: z.string().min(1),
  agentRole: z.string().min(1),
  taskId: z.string().min(1),
  /** ms since epoch when the token was issued. */
  issuedAt: z.number().int().nonnegative(),
  /** ms since epoch after which the token is rejected. */
  expiresAt: z.number().int().positive(),
  /** Hex HMAC-SHA256 signature of the canonicalised payload. */
  signature: z.string().min(1),
  /** True if the token can be redeemed multiple times before expiry. */
  singleUse: z.boolean().default(true),
});
export type CapabilityToken = z.infer<typeof CapabilityTokenSchema>;

/**
 * Canonical request shape for `CapabilityBroker.issue`.
 */
export const CapabilityIssueRequestSchema = z.object({
  name: CapabilityNameSchema,
  scope: z.string().min(1),
  agentRole: z.string().min(1),
  taskId: z.string().min(1),
  /**
   * Optional override on the default TTL. Capped at the capability's `ttlMs`.
   */
  requestedTtlMs: z.number().int().positive().optional(),
  /** Free-form reason recorded with the ledger entry. */
  reason: z.string().min(1).max(500),
});
export type CapabilityIssueRequest = z.infer<
  typeof CapabilityIssueRequestSchema
>;

/**
 * The action the executor is asked to perform once the token is validated.
 *
 * The shape is intentionally generic so the executor can host pluggable
 * action handlers (one per capability name) without coupling this package
 * to any external API client.
 */
export const ActionPayloadSchema = z.object({
  /** The capability the action exercises (must match the token). */
  name: CapabilityNameSchema,
  /** Resource scope (must match the token). */
  scope: z.string().min(1),
  /** Action-handler-specific arguments. */
  args: z.record(z.unknown()).default({}),
});
export type ActionPayload = z.infer<typeof ActionPayloadSchema>;

/**
 * Result of a capability execution. The executor stores this verbatim on the
 * ledger entry so an operator can replay or compensate the action later.
 */
export const ActionResultSchema = z.object({
  ok: z.boolean(),
  /** Action-handler-specific structured result. */
  data: z.unknown().optional(),
  /** Action-handler-specific error message when ok=false. */
  error: z.string().optional(),
  /**
   * Optional pointer to a compensating action (e.g. a deploy rollback
   * url, a git revert sha, a database snapshot id) recorded so an operator
   * can undo the effect from the dashboard.
   */
  undoToken: z.string().optional(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

/**
 * Append-only ledger row. One per privileged execution.
 */
export const LedgerEntrySchema = z.object({
  id: z.string().min(1),
  ts: z.number().int().nonnegative(),
  agentRole: z.string().min(1),
  taskId: z.string().min(1),
  capabilityName: CapabilityNameSchema,
  scope: z.string().min(1),
  reason: z.string().min(1),
  /** JSON-serialised action payload. */
  actionPayloadJson: z.string().min(1),
  /** JSON-serialised action result. */
  resultJson: z.string().min(1),
  /** Optional undo pointer (extracted from the result). */
  undoToken: z.string().nullable(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
