// H-5 / H-17 (chain-runner-battle-harden phase 5, 2026-05-14). Stall root-cause
// analysis. Walks the dependency graph from the first non-`done` phase and
// reports the upstream blocker (status, failure class, attempts), then
// suggests an adjudication CLI invocation the operator can run to unblock the
// chain. Used by `caia-chain stall-root-cause` and surfaced in the
// chain_stalled alert detail string so the inbox/handoff blocks are
// actionable instead of just descriptive.

import type {
  ChainSpec,
  PhaseDefinition,
  PhaseState,
  StateFile,
} from './types.js';

export interface RootCauseDiagnosis {
  /** First phase that is not yet `done`, walking ids in spec order. */
  nextPending: PhaseDefinition | null;
  /**
   * The upstream phase blocking progress, if any. This is the deepest non-done
   * ancestor of `nextPending` whose status is `blocked` or `failed`. When
   * `nextPending` itself is dispatchable (deps met) and not yet started, this
   * is null and the diagnosis explains that the chain is simply idle / not
   * yet woken.
   */
  blocker: PhaseDefinition | null;
  blockerState: PhaseState | null;
  /** Free-form human summary suitable for INBOX/HANDOFF rendering. */
  diagnosis: string;
  /** Suggested CLI command. May be a multi-line string. */
  suggested: string;
}

export function diagnoseStall(spec: ChainSpec, state: StateFile): RootCauseDiagnosis {
  if (state.all_done) {
    return {
      nextPending: null,
      blocker: null,
      blockerState: null,
      diagnosis: 'Chain is all_done; no stall to diagnose.',
      suggested: '(no action — chain finished)',
    };
  }
  if (state.paused) {
    const until = state.paused_until ?? null;
    const reason = state.paused_reason ?? '(no reason recorded)';
    return {
      nextPending: null,
      blocker: null,
      blockerState: null,
      diagnosis: `Chain is paused: ${reason}${until ? ` (paused_until=${until})` : ''}`,
      suggested:
        until !== null
          ? `wait for ${until}, or run \`caia-chain resume --chain-id <id> --phases <yaml>\``
          : `run \`caia-chain resume --chain-id <id> --phases <yaml>\``,
    };
  }
  const nextPending = firstNonDone(spec, state);
  if (!nextPending) {
    return {
      nextPending: null,
      blocker: null,
      blockerState: null,
      diagnosis:
        'No non-done phase found, but state.all_done=false — invariant broken; inspect state.json.',
      suggested:
        'Run `caia-chain status` and verify phase_status; an adjudication may be required.',
    };
  }

  // Walk the dependency graph upward to find the deepest blocker.
  const blockerPid = findDeepestBlocker(spec, state, nextPending.id);
  if (blockerPid === null) {
    const deps = nextPending.deps ?? [];
    return {
      nextPending,
      blocker: null,
      blockerState: null,
      diagnosis:
        `Phase ${nextPending.id} (${nextPending.name}) is pending; deps=[${deps.join(',')}] all done. ` +
        `Chain may be idle (wake not yet fired) or in backoff.`,
      suggested:
        `Verify a wake has fired (\`caia-chain audit-tail\`); inspect backoff_until on the phase.`,
    };
  }
  const blocker = spec.phases.find((p) => p.id === blockerPid) ?? null;
  const blockerState = state.phase_status[String(blockerPid)] ?? null;
  const cls =
    blockerState?.last_failure_class ?? blockerState?.failure?.class ?? 'unknown';
  const attempts = blockerState?.attempts ?? 0;
  const reason = blockerState?.failure?.reason ?? blockerState?.error ?? '(no recorded reason)';

  const diagnosis =
    `Phase ${nextPending.id} (${nextPending.name}) cannot run because ` +
    `phase ${blockerPid} (${blocker?.name ?? '?'}) is ${blockerState?.status ?? '?'} ` +
    `[class=${cls} attempts=${attempts}]: ${reason}`;

  const suggested = suggestRecovery(blockerPid, blockerState, cls);

  return {
    nextPending,
    blocker,
    blockerState,
    diagnosis,
    suggested,
  };
}

function firstNonDone(spec: ChainSpec, state: StateFile): PhaseDefinition | null {
  for (const p of spec.phases) {
    const ps = state.phase_status[String(p.id)];
    if (!ps) continue;
    if (ps.status !== 'done') return p;
  }
  return null;
}

// Recursive walk: for the target phase, if any of its deps is non-done, recurse
// into that dep. The deepest reachable non-done is the blocker. Cycles in the
// dep graph would be a spec error (loadChainSpec doesn't currently check that),
// so we guard with a visited set.
function findDeepestBlocker(
  spec: ChainSpec,
  state: StateFile,
  targetId: number,
  visited: Set<number> = new Set(),
): number | null {
  if (visited.has(targetId)) return null;
  visited.add(targetId);
  const target = spec.phases.find((p) => p.id === targetId);
  if (!target) return null;
  for (const depId of target.deps ?? []) {
    const depState = state.phase_status[String(depId)];
    if (!depState) continue;
    if (depState.status === 'done') continue;
    // Found a non-done dep. Recurse to see if it has its own blocker.
    const deeper = findDeepestBlocker(spec, state, depId, visited);
    return deeper ?? depId;
  }
  // No non-done deps. If the target itself is blocked or failed, IT is the blocker.
  const targetState = state.phase_status[String(targetId)];
  if (targetState && (targetState.status === 'blocked' || targetState.status === 'failed')) {
    return targetId;
  }
  return null;
}

function suggestRecovery(
  blockerId: number,
  blockerState: PhaseState | null,
  cls: string,
): string {
  const re_arm = `caia-chain re-arm ${blockerId} --reset-attempts --reason '<your reason>'`;
  switch (cls) {
    case 'worker_no_start_rate_limit': {
      const reset = blockerState?.failure?.evidence?.['reset_iso'];
      return reset
        ? `Wait for rate-limit reset at ${String(reset)}, then run:\n  ${re_arm}`
        : `Wait for rate-limit reset (check preflight banner), then run:\n  ${re_arm}`;
    }
    case 'worker_no_start_auth_failure':
      return `OPERATOR_ACTION_REQUIRED: re-authenticate the claude CLI (\`claude logout && claude\`), then run:\n  ${re_arm}`;
    case 'worker_no_start_binary_missing':
      return `OPERATOR_ACTION_REQUIRED: install / fix path to the claude binary, then run:\n  ${re_arm}`;
    case 'worker_hung_post_success':
      return `If artifact/PR look correct, adjudicate to done:\n  caia-chain adjudicate ${blockerId} --to done --reason 'hung-post-success; verified manually'`;
    case 'runtime_exceeded':
      return `Inspect the dispatch log; if expected, raise max_minutes for this phase in the YAML, then:\n  ${re_arm}`;
    default:
      return `Inspect the failure evidence, fix the underlying cause, then:\n  ${re_arm}`;
  }
}
