/**
 * @caia/ea-dispatcher — dispatcher.ts
 *
 * The orchestrator. Sourced from research/17_architect_framework_spec_2026.md §3.
 *
 * Flow (deterministic, no LLM):
 *
 *   1. Read world: ticket, business plan, design version, tenant context.
 *   2. Filter the registered architect set by `appliesPredicate(ticket)`.
 *   3. Topo-sort the survivors via Kahn's algorithm (computeWaves).
 *   4. For each wave: spawn each member in parallel via the ArchitectInvoker.
 *      - Apply the per-architect wall-clock deadline.
 *      - Validate the output's `architectureFields` keys against the contract;
 *        on schema mismatch, retry ONCE with a corrected prompt fragment.
 *      - On second failure, mark the architect as `failed` and proceed.
 *   5. Compose all `ok`/`partial` outputs into a single jsonb blob via
 *      disjoint-key merge. Collisions (impossible-by-construction) throw.
 *   6. Detect semantic conflicts via the rule registry; resolve via the
 *      precedence ladder — loser fields get `_dissent` annotations.
 *   7. Per-architect telemetry rows to the TelemetrySink.
 *   8. Transition the project state via the StateMachineAdapter:
 *        - >failureThreshold failed → 'ea-dispatching-failed'.
 *        - otherwise → 'ea-complete'.
 */

import {
  computeWaves,
  type ArchitectInput,
  type ArchitectOutput,
  type ArchitectName,
  type ArchitectUpstreamContext,
  type SpecialistArchitect,
  type Wave,
} from '@caia/architect-kit';

import { partitionByApplies, selectByName } from './applies.js';
import {
  composeArchitectOutputs,
  CompositionError,
} from './composer.js';
import {
  detectConflicts,
  SEMANTIC_CONFLICT_RULES,
  type SemanticConflictRule,
} from './conflict-rules.js';
import { resolveConflicts } from './precedence-resolver.js';
import {
  DefaultArchitectInvoker,
  InMemoryTelemetrySink,
  NoopStateMachine,
  SystemClock,
} from './invoker.js';
import {
  DEFAULT_DISPATCHER_OPTIONS,
  type ArchitectCallRecord,
  type ArchitectInvoker,
  type Clock,
  type ConflictRecord,
  type DispatchInput,
  type DispatchResult,
  type DispatcherOptions,
  type StateMachineAdapter,
  type TelemetrySink,
} from './types.js';

/** Agent ID used in state-machine transitions + ticket claims. */
export const DISPATCHER_AGENT_ID = 'ea-dispatcher';

export interface DispatcherDeps {
  architects: readonly SpecialistArchitect[];
  stateMachine?: StateMachineAdapter;
  invoker?: ArchitectInvoker;
  telemetry?: TelemetrySink;
  clock?: Clock;
  /** Override the conflict rule set (tests). */
  conflictRules?: readonly SemanticConflictRule[];
  /** Optional project ID for state-machine transitions; defaults to ticket.id. */
  projectIdOf?: (ticketId: string) => string;
}

export class Dispatcher {
  private readonly architects: readonly SpecialistArchitect[];
  private readonly stateMachine: StateMachineAdapter;
  private readonly invoker: ArchitectInvoker;
  private readonly telemetry: TelemetrySink;
  private readonly clock: Clock;
  private readonly rules: readonly SemanticConflictRule[];
  private readonly opts: Required<DispatcherOptions>;
  private readonly projectIdOf: (ticketId: string) => string;

  constructor(deps: DispatcherDeps, opts: DispatcherOptions = {}) {
    this.architects = deps.architects;
    this.stateMachine = deps.stateMachine ?? new NoopStateMachine();
    this.invoker = deps.invoker ?? new DefaultArchitectInvoker();
    this.telemetry = deps.telemetry ?? new InMemoryTelemetrySink();
    this.clock = deps.clock ?? new SystemClock();
    this.rules = deps.conflictRules ?? SEMANTIC_CONFLICT_RULES;
    this.projectIdOf = deps.projectIdOf ?? ((id) => id);
    this.opts = { ...DEFAULT_DISPATCHER_OPTIONS, ...opts };
  }

  // ─── Public entrypoint ──────────────────────────────────────────────────

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const iteration = input.iteration ?? 1;
    if (iteration > this.opts.maxIterations) {
      throw new Error(
        `iteration ${iteration} exceeds maxIterations ${this.opts.maxIterations} — reviewer must escalate to operator`,
      );
    }

    // Claim the ticket. Honour state-machine errors but proceed even if the
    // claim is a no-op (some orchestrators pre-claim and pass us a context).
    await this.stateMachine.claimTicketForAgent(input.ticket.id, DISPATCHER_AGENT_ID, {
      ttlSeconds: this.opts.claimTtlSeconds,
    });

    let result: DispatchResult;
    try {
      result = await this.runFanout(input);
    } catch (err) {
      // Catastrophic failure path — release ticket as failed and rethrow
      // (the orchestrator's outer catch wires the operator notification).
      await this.stateMachine.releaseTicket(
        input.ticket.id,
        DISPATCHER_AGENT_ID,
        'failed',
      );
      throw err;
    }

    // Transition project state per outcome.
    await this.stateMachine.transition(
      this.projectIdOf(input.ticket.id),
      result.finalState,
      {
        reason: result.reason,
        triggeredBy: { kind: 'agent', id: DISPATCHER_AGENT_ID },
        payload: {
          composedKeys: Object.keys(result.composedArchitecture),
          conflictCount: result.conflicts.length,
        },
      },
    );

    await this.stateMachine.releaseTicket(
      input.ticket.id,
      DISPATCHER_AGENT_ID,
      result.finalState === 'ea-complete' ? 'done' : 'failed',
    );

    return result;
  }

  // ─── Internal — pure fan-out (no state-machine I/O) ─────────────────────

  private async runFanout(input: DispatchInput): Promise<DispatchResult> {
    // 1. Filter to applicable.
    let candidates = this.architects;
    if (input.rerunFor && input.rerunFor.length > 0) {
      const names = input.rerunFor.map((r) => r.architect);
      candidates = selectByName(candidates, names);
    }
    const { applicable, skipped } = partitionByApplies(candidates, input.ticket);

    if (applicable.length === 0) {
      const ticketId = input.ticket.id;
      return {
        ticketId,
        composedArchitecture: {},
        outputs: [],
        telemetry: { calls: [], skipped },
        finalState: 'ea-complete',
        reason: 'no architects applied to this ticket',
        conflicts: [],
        plan: [],
      };
    }

    // 2. Topo-sort into waves.
    const waves = computeWaves(applicable);

    // 3. Execute waves serially; members in parallel within each wave.
    const allOutputs: ArchitectOutput[] = [];
    const allCalls: ArchitectCallRecord[] = [];
    const upstream: ArchitectUpstreamContext = { outputs: {} };
    const upstreamMut = upstream.outputs as Record<string, ArchitectOutput>;

    for (const wave of waves) {
      const waveMembers = wave.members
        .map((n) => applicable.find((a) => a.name === n))
        .filter((a): a is SpecialistArchitect => !!a);
      const waveOutputs = await this.runWave(waveMembers, input, upstream, allCalls);
      for (const out of waveOutputs) {
        allOutputs.push(out);
        upstreamMut[out.architectName] = out;
      }
    }

    // 4. Telemetry — flush call rows.
    for (const row of allCalls) {
      await this.telemetry.recordArchitectCall(row);
    }

    // 5. Compose disjoint-key.
    let composed: Record<string, unknown> = {};
    let reason = '';
    let finalState: DispatchResult['finalState'] = 'ea-complete';
    let conflicts: readonly ConflictRecord[] = [];
    try {
      const compose = composeArchitectOutputs(allOutputs);
      composed = compose.composed;
      reason = `composed ${Object.keys(composed).length} paths across ${allOutputs.length} architects`;
    } catch (err) {
      if (err instanceof CompositionError) {
        // Hard failure — disjointness invariant violated.
        finalState = 'ea-dispatching-failed';
        reason = err.message;
      } else {
        throw err;
      }
    }

    // 6. Detect + resolve conflicts when composition succeeded.
    if (finalState === 'ea-complete') {
      const fired = detectConflicts(composed, this.rules);
      if (fired.length > 0) {
        conflicts = resolveConflicts(fired, composed);
      }
    }

    // 7. Check failure threshold.
    const failedCount = allOutputs.filter((o) => o.status === 'failed').length;
    const failureRatio = applicable.length > 0 ? failedCount / applicable.length : 0;
    if (finalState === 'ea-complete' && failureRatio > this.opts.failureThreshold) {
      finalState = 'ea-dispatching-failed';
      reason = `${failedCount}/${applicable.length} architects failed (>${this.opts.failureThreshold * 100}% threshold)`;
    }

    return {
      ticketId: input.ticket.id,
      composedArchitecture: composed,
      outputs: allOutputs,
      telemetry: { calls: allCalls, skipped },
      finalState,
      reason,
      conflicts,
      plan: waves.map((w) => ({ wave: w.index, members: w.members })),
    };
  }

  /**
   * Run a single wave in parallel — respects `maxConcurrentSpawns` by
   * sub-batching when the wave is larger.
   */
  private async runWave(
    members: readonly SpecialistArchitect[],
    dispatch: DispatchInput,
    upstream: ArchitectUpstreamContext,
    callsAcc: ArchitectCallRecord[],
  ): Promise<readonly ArchitectOutput[]> {
    const cap = this.opts.maxConcurrentSpawns;
    const outputs: ArchitectOutput[] = [];
    for (let i = 0; i < members.length; i += cap) {
      const batch = members.slice(i, i + cap);
      const batchOutputs = await Promise.all(
        batch.map((arch) => this.runArchitect(arch, dispatch, upstream, callsAcc)),
      );
      outputs.push(...batchOutputs);
    }
    return outputs;
  }

  /**
   * Run a single architect — apply the deadline, validate the output's
   * key set, retry once on schema mismatch with the missing-key hint.
   */
  private async runArchitect(
    arch: SpecialistArchitect,
    dispatch: DispatchInput,
    upstream: ArchitectUpstreamContext,
    callsAcc: ArchitectCallRecord[],
  ): Promise<ArchitectOutput> {
    const input = this.makeArchitectInput(arch, dispatch, upstream);
    const startedAt = this.clock.isoNow();
    const startedMs = this.clock.now();

    // Heartbeat — non-fatal if it errors.
    void this.stateMachine
      .heartbeat(dispatch.ticket.id, DISPATCHER_AGENT_ID)
      .catch(() => undefined);

    let out = await this.invoker.invoke(arch, input, this.opts.perArchitectTimeoutMs);
    let retries = 0;

    if (
      this.opts.retryOnSchemaMismatch &&
      shouldRetry(arch, out)
    ) {
      retries = 1;
      const missing = missingPathsFor(arch, out);
      const retryInput: ArchitectInput = {
        ...input,
        reviewerFeedback: {
          reason: `previous output was missing required keys: ${missing.join(', ')}`,
          severity: 'P1',
          ...(input.reviewerFeedback ? { hints: input.reviewerFeedback.hints } : {}),
        },
      };
      out = await this.invoker.invoke(arch, retryInput, this.opts.perArchitectTimeoutMs);

      // Even after retry, if still mismatched we mark as failed.
      if (shouldRetry(arch, out)) {
        out = {
          ...out,
          status: 'failed',
          failureReason: `schema mismatch after retry — still missing: ${missingPathsFor(arch, out).join(', ')}`,
        };
      }
    }

    const endedAt = this.clock.isoNow();
    const endedMs = this.clock.now();
    const row: ArchitectCallRecord = {
      ticketId: dispatch.ticket.id,
      architectName: arch.name,
      status: out.status,
      confidence: out.confidence,
      spend: { ...out.spend, wallClockMs: out.spend.wallClockMs || endedMs - startedMs },
      toolCalls: out.toolCalls,
      notes: out.notes,
      risks: out.risks,
      retries,
      startedAt,
      endedAt,
      ...(out.failureReason ? { failureReason: out.failureReason } : {}),
    };
    callsAcc.push(row);
    return out;
  }

  private makeArchitectInput(
    arch: SpecialistArchitect,
    dispatch: DispatchInput,
    upstream: ArchitectUpstreamContext,
  ): ArchitectInput {
    const rerun = dispatch.rerunFor?.find((r) => r.architect === arch.name);
    const meta = arch.sectionContract.architectMeta;
    return {
      ticket: dispatch.ticket,
      upstream,
      businessPlan: dispatch.businessPlan,
      designVersion: dispatch.designVersion,
      tenantContext: dispatch.tenantContext,
      budget: {
        maxInputTokens: 60_000,
        maxOutputTokens: 8_000,
        maxWallClockMs: this.opts.perArchitectTimeoutMs,
        preferredModel: meta.runtimeModel,
        hardCostCeilingUsd: 1.0,
      },
      ...(rerun
        ? {
            reviewerFeedback: {
              reason: rerun.reason,
              severity: rerun.severity ?? 'P1',
            },
          }
        : {}),
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function shouldRetry(
  arch: SpecialistArchitect,
  out: ArchitectOutput,
): boolean {
  if (out.status === 'failed') return false; // can't retry a failed output usefully without new info
  return missingPathsFor(arch, out).length > 0;
}

function missingPathsFor(
  arch: SpecialistArchitect,
  out: ArchitectOutput,
): readonly string[] {
  const required = arch.sectionContract.sections
    .filter((s) => s.required)
    .map((s) => s.path);
  return required.filter(
    (p) => !(p in out.architectureFields) || out.architectureFields[p] == null,
  );
}

// ─── Functional entrypoint ─────────────────────────────────────────────────

/**
 * Convenience: build a Dispatcher and run a single dispatch. The class
 * surface is the canonical form; this functional flavour is handy in tests
 * and scripts.
 */
export async function dispatch(
  deps: DispatcherDeps,
  input: DispatchInput,
  opts?: DispatcherOptions,
): Promise<DispatchResult> {
  return new Dispatcher(deps, opts).dispatch(input);
}
