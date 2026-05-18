/**
 * Spend-guard types — Zod schemas + inferred TS types per v2 §6.2.
 */

import { z } from 'zod';

/**
 * Where the spend was billed. The pool router preferentially uses
 * `subscription` (Max-account quota), falls back to `api-key` (sticker
 * rate) when the subscription rate-limits, and routes to `ollama` (free
 * local) when CAIA's local-llm-router decides a request is local-eligible.
 */
export const SpendViaSchema = z.enum(['subscription', 'api-key', 'ollama']);
export type SpendVia = z.infer<typeof SpendViaSchema>;

/**
 * Cap scopes. Each scope has its own budget + counter row in
 * `spend_caps`.
 *
 * Defaults per v2 §6.4:
 *   - `task`        : $1.50
 *   - `project`     : $30
 *   - `global-day`  : $25
 *   - `global-week` : $100
 *   - `global-month`: $200 (P5 plan §3 M0)
 */
export const SpendCapScopeSchema = z.enum([
  'task',
  'project',
  'global-day',
  'global-week',
  'global-month',
]);
export type SpendCapScope = z.infer<typeof SpendCapScopeSchema>;

export const SpendCapSchema = z.object({
  scope: SpendCapScopeSchema,
  /** Resource id this cap applies to. For `task`, the task id; for
   * `project`, the project id; for `global-*`, the literal `'global'`. */
  resourceId: z.string().min(1),
  /** Period in seconds. For `task`/`project`/`global-week` cap reset
   * cadence depends on caller. For `global-day`, 86_400. */
  periodSec: z.number().int().positive(),
  limitUsd: z.number().nonnegative(),
  currentUsd: z.number().nonnegative().default(0),
  /** Wall-clock ms when the cap was last reset. */
  lastResetMsEpoch: z.number().int().nonnegative(),
  /**
   * Wall-clock ms after which a `BudgetExceeded` cap is reconsidered
   * automatically. When `null` the cap stays locked until an operator
   * resumes via CLI / dashboard.
   */
  lockedUntilMsEpoch: z.number().int().nonnegative().nullable().default(null),
});
export type SpendCap = z.infer<typeof SpendCapSchema>;

export const SpendRecordSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  projectId: z.string().min(1).nullable().default(null),
  agentRole: z.string().min(1),
  model: z.string().min(1),
  via: SpendViaSchema,
  /** Account id when via === 'subscription' / 'api-key'; null for ollama. */
  accountId: z.string().min(1).nullable().default(null),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Cost in USD (computed by the cost map). */
  costUsd: z.number().nonnegative(),
  tsMsEpoch: z.number().int().nonnegative(),
});
export type SpendRecord = z.infer<typeof SpendRecordSchema>;

/** Per-1M-tokens prices for input / output. */
export const ModelCostSchema = z.object({
  inputUsdPerMillion: z.number().nonnegative(),
  outputUsdPerMillion: z.number().nonnegative(),
});
export type ModelCost = z.infer<typeof ModelCostSchema>;

/** v2 §6.4 default cost map. Tracks the public Anthropic Apr-2026 rates. */
export const DEFAULT_MODEL_COSTS: Readonly<Record<string, ModelCost>> = Object.freeze({
  'claude-opus-4-6': { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  'claude-opus-4-7': { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  'claude-sonnet-4-6': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'claude-haiku-4-5': { inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.25 },
  // Sticker-rate fallback for any unknown model id.
  '_default': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
});

/** v2 §6.4 default per-scope caps (USD). */
export const DEFAULT_CAPS_USD: Readonly<Record<SpendCapScope, number>> = Object.freeze({
  'task': 1.5,
  'project': 30,
  'global-day': 25,
  'global-week': 100,
  // Per P5 plan §3 M0: cloud cap extended to ≤$200/mo (2026-05-17).
  'global-month': 200,
});

/**
 * Account-pool mode — Prakash 2026-04-29 update reverses the v2 default:
 * keep 2 accounts as the default, log a one-time ToS-fragility warning
 * but don't block.
 */
export const AccountPoolModeSchema = z.enum(['multi', 'single', 'api-fallback']);
export type AccountPoolMode = z.infer<typeof AccountPoolModeSchema>;

export const AccountStateSchema = z.object({
  accountId: z.string().min(1),
  /** USD spent on this account in the current rolling-week window. */
  weekUsd: z.number().nonnegative().default(0),
  /** Operator-supplied weekly cap for this account. */
  weeklyCapUsd: z.number().positive(),
  /** Wall-clock when this account was last rotated to / from. */
  lastRotationMsEpoch: z.number().int().nonnegative().default(0),
  /** True when Anthropic returned a 429 / quota exceeded recently. */
  rateLimited: z.boolean().default(false),
  /** True when the account is suspended / banned. */
  suspended: z.boolean().default(false),
});
export type AccountState = z.infer<typeof AccountStateSchema>;
