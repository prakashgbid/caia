/**
 * `run()` — the architect's runtime entry point. Idempotent given
 * identical input (per spec §1.1).
 *
 * Flow:
 *   1. Build the user prompt by serialising relevant slices of the input.
 *   2. Call the spawner with the system prompt + user prompt.
 *   3. Validate the output against the contract.
 *   4. Return the `ArchitectOutput` with spend telemetry filled in.
 *
 * Re-runs REPLACE owned fields (no append).
 *
 * Architect-specific projections vs the canonical template:
 *   - Security is wave-2; both Backend and Database run upstream.
 *   - `dependencies` always includes ['backend', 'database'] regardless
 *     of what the model emitted (preserving sibling-ticket IDs).
 *   - Tenant context exposes `vaultNamespace` + `schemaName` so the
 *     architect can declare `secretsHandling.namespace` and
 *     cross-validate `tenantIsolationGuarantees`.
 */

import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSpend
} from './types.js';

import { SECURITY_OWNED_FIELD_KEYS } from './contract.js';
import type { ArchitectSpawnerFn } from './spawner.js';
import { validateArchitectOutput } from './validation.js';

export interface RunDeps {
  spawner: ArchitectSpawnerFn;
  systemPrompt: string;
  architectName: string;
}

export function buildUserPrompt(input: ArchitectInput): string {
  const projection = {
    ticket: input.ticket,
    businessPlan: input.businessPlan,
    designVersion: input.designVersion,
    tenantContext: {
      tenantId: input.tenantContext.tenantId,
      schemaName: input.tenantContext.schemaName,
      vaultNamespace: input.tenantContext.vaultNamespace,
      billingPosture: input.tenantContext.billingPosture
    },
    upstreamOutputs: input.upstream.outputs,
    reviewerFeedback: input.reviewerFeedback ?? null,
    budget: {
      model: input.budget.preferredModel,
      maxOutputTokens: input.budget.maxOutputTokens
    }
  };
  return JSON.stringify(projection, null, 2);
}

export async function runSecurityArchitect(
  input: ArchitectInput,
  deps: RunDeps
): Promise<ArchitectOutput> {
  const userPrompt = buildUserPrompt(input);

  const spawn = await deps.spawner({
    systemPrompt: deps.systemPrompt,
    userPrompt,
    budget: input.budget
  });

  const spend: ArchitectSpend = {
    inputTokens: spawn.inputTokens,
    outputTokens: spawn.outputTokens,
    usdCost: spawn.usdCost,
    wallClockMs: spawn.wallClockMs,
    model: spawn.model
  };

  if (!spawn.ok) {
    return {
      architectName: deps.architectName,
      architectureFields: {},
      confidence: 0,
      notes: 'Spawn failed before any architecture was produced.',
      dependencies: ['backend', 'database'],
      risks: [`spawn failure: ${spawn.diagnostic ?? 'unknown'}`],
      toolCalls: [],
      spend,
      status: 'failed',
      failureReason: spawn.diagnostic ?? 'spawner returned ok=false'
    };
  }

  const validation = validateArchitectOutput(spawn.text, SECURITY_OWNED_FIELD_KEYS);
  if (!validation.ok || !validation.parsed) {
    const errorSummary = validation.errors
      .slice(0, 5)
      .map(e => `${e.code}${e.field ? `:${e.field}` : ''}`)
      .join('; ');
    return {
      architectName: deps.architectName,
      architectureFields: {},
      confidence: 0,
      notes: `Validation failed: ${errorSummary}`,
      dependencies: ['backend', 'database'],
      risks: validation.errors.slice(0, 5).map(e => e.message),
      toolCalls: [],
      spend,
      status: 'partial',
      failureReason: errorSummary
    };
  }

  const parsed = validation.parsed;
  const upstreamDeps = ensureUpstreamDependencies(parsed.dependencies);
  return {
    ...parsed,
    architectName: deps.architectName,
    dependencies: upstreamDeps,
    spend
  };
}

/**
 * Ensure `backend` and `database` are present in the dependency list
 * (preserving any sibling-ticket IDs the model emitted). Idempotent —
 * does not duplicate.
 */
function ensureUpstreamDependencies(
  emitted: readonly string[] | undefined
): readonly string[] {
  const set = new Set(emitted ?? []);
  set.add('backend');
  set.add('database');
  return Array.from(set);
}
