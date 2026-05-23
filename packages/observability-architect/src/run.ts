/**
 * `run()` — the architect's runtime entry point. Idempotent given
 * identical input (per spec §1.1).
 *
 * Flow:
 *   1. Build the user prompt by serialising relevant slices of the input
 *      (including the upstream Backend output that Observability
 *      depends on).
 *   2. Call the spawner with the system prompt + user prompt.
 *   3. Validate the output against the contract.
 *   4. Return the `ArchitectOutput` with spend telemetry filled in.
 *
 * Re-runs REPLACE owned fields (no append) — the architect always emits
 * the full set of its owned fields fresh.
 *
 * Failure handling:
 *   - Spawner errored → return `status='failed'` with diagnostic.
 *   - Validator errored → return `status='partial'` with the validation
 *     errors stitched into `risks[]`.
 *
 * Dependency note: Observability depends on Backend's `apiEndpoints` +
 * `errorEnvelope` + `rateLimits`. If `upstream.outputs.backend` is
 * absent we still call the spawner — the system prompt instructs the
 * model to emit best-effort specs and surface the missing-upstream
 * condition under `risks[]`.
 */

import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSpend
} from './types.js';

import { OBSERVABILITY_OWNED_FIELD_KEYS } from './contract.js';
import type { ArchitectSpawnerFn } from './spawner.js';
import { validateArchitectOutput } from './validation.js';

export interface RunDeps {
  spawner: ArchitectSpawnerFn;
  systemPrompt: string;
  architectName: string;
}

/**
 * Project the input down to the JSON body the architect prompt expects.
 * Privacy-sensitive tenant fields (schemaName, vaultNamespace) are
 * omitted; the architect doesn't need them.
 */
export function buildUserPrompt(input: ArchitectInput): string {
  const projection = {
    ticket: input.ticket,
    businessPlan: input.businessPlan,
    designVersion: input.designVersion,
    tenantContext: {
      tenantId: input.tenantContext.tenantId,
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

/**
 * The runtime entry. Pure aside from the spawner call.
 */
export async function runObservabilityArchitect(
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
      dependencies: [],
      risks: [`spawn failure: ${spawn.diagnostic ?? 'unknown'}`],
      toolCalls: [],
      spend,
      status: 'failed',
      failureReason: spawn.diagnostic ?? 'spawner returned ok=false'
    };
  }

  const validation = validateArchitectOutput(spawn.text, OBSERVABILITY_OWNED_FIELD_KEYS);
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
      dependencies: [],
      risks: validation.errors.slice(0, 5).map(e => e.message),
      toolCalls: [],
      spend,
      status: 'partial',
      failureReason: errorSummary
    };
  }

  const parsed = validation.parsed;
  return {
    ...parsed,
    architectName: deps.architectName,
    spend
  };
}
