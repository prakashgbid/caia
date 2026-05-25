/**
 * Policy: `dod-stewards-green`
 *
 * Derived from:
 *   - PR #567 (`@caia/state-machine`) — Solution lifecycle FSM (Real-DoD).
 *   - PR #566 (`@caia/activation-steward`) — Layer 2 of Real-DoD.
 *   - The four steward packages on develop:
 *       activation-steward, ea-doc-steward, outcome-steward, plan-defender.
 *
 * Rule: a dispatch that completes a piece of work (intent in `build` or
 * `ops`) must show all four stewards reporting `green`. If any steward is
 * `red` or `unknown` (stale > 24h), the dispatch's "done" claim is rejected.
 *
 * Mode: `hard-fail` for `red`; `soft-fail` for `unknown`. Bootstrap-exempt
 * dispatches (e.g. the one that introduces this very policy) set
 * `metadata.dodBootstrapExempt: true`.
 *
 * The 4 stewards are sourced from `ctx.dodStewards`. If `dodStewards` is
 * undefined, the policy treats the snapshot as `unknown` and soft-fails so
 * the engine surfaces an INBOX entry rather than silently passing.
 *
 * For dispatches not claiming "done" (`intent in ['research','spec']`), the
 * policy is a no-op.
 */

import type {
  DispatchContext,
  DodStewardSnapshot,
  Policy,
  PolicyEvidence,
  PolicyMode,
  PolicyVerdict,
  StewardStatus
} from '../types.js';

const STEWARD_KEYS: ReadonlyArray<keyof DodStewardSnapshot> = [
  'activationSteward',
  'eaDocSteward',
  'outcomeSteward',
  'planDefender'
];

/** Maximum snapshot age before a green/red value is downgraded to unknown. */
export const SNAPSHOT_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export function freshness(
  snapshot: DodStewardSnapshot | undefined,
  now: Date = new Date()
): 'fresh' | 'stale' | 'unknown' {
  if (!snapshot) return 'unknown';
  if (!snapshot.snapshotAt) return 'unknown';
  const t = Date.parse(snapshot.snapshotAt);
  if (Number.isNaN(t)) return 'unknown';
  return now.getTime() - t < SNAPSHOT_FRESHNESS_MS ? 'fresh' : 'stale';
}

function collectRedAndUnknown(
  snapshot: DodStewardSnapshot,
  fresh: boolean
): { reds: string[]; unknowns: string[] } {
  const reds: string[] = [];
  const unknowns: string[] = [];
  for (const key of STEWARD_KEYS) {
    const value: StewardStatus | undefined = snapshot[key] as StewardStatus | undefined;
    if (!value) {
      unknowns.push(String(key));
      continue;
    }
    if (!fresh) {
      // Stale snapshot — treat every steward as unknown.
      unknowns.push(String(key));
      continue;
    }
    if (value === 'red') reds.push(String(key));
    else if (value === 'unknown') unknowns.push(String(key));
  }
  return { reds, unknowns };
}

function appliesToIntent(intent: DispatchContext['intent']): boolean {
  return intent === 'build' || intent === 'ops' || intent === 'review';
}

export const dodStewardsGreenPolicy: Policy = {
  id: 'dod-stewards-green',
  description:
    'Real Definition-of-Done: all four stewards (activation-steward, ea-doc-steward, outcome-steward, plan-defender) must report green before a build/ops/review dispatch is admitted. Source: PR #567 (state-machine) + PR #566 (activation-steward).',
  defaultMode: 'hard-fail',
  async check(ctx: DispatchContext): Promise<PolicyVerdict> {
    if (!appliesToIntent(ctx.intent)) {
      return { ok: true };
    }
    if (ctx.metadata?.['dodBootstrapExempt'] === true) {
      return { ok: true };
    }
    const snapshot = ctx.dodStewards;
    const fresh = freshness(snapshot) === 'fresh';
    if (!snapshot) {
      return {
        ok: false,
        mode: 'soft-fail',
        reason:
          'No DoD steward snapshot present on dispatch context. The four-steward freshness check (activation-steward, ea-doc-steward, outcome-steward, plan-defender) cannot be evaluated.',
        suggestedFix:
          'Populate ctx.dodStewards with a fresh snapshot from each steward. Run `pnpm --filter @caia/activation-steward run report` and equivalents, then dispatch again.',
        evidence: [
          { source: 'dispatchContext.dodStewards', snippet: '<missing>' }
        ]
      };
    }
    const { reds, unknowns } = collectRedAndUnknown(snapshot, fresh);
    if (reds.length === 0 && unknowns.length === 0) {
      return { ok: true };
    }
    const mode: PolicyMode = reds.length > 0 ? 'hard-fail' : 'soft-fail';
    const evidence: PolicyEvidence[] = [];
    for (const k of reds) {
      evidence.push({
        source: `dodStewards.${k}`,
        snippet: 'red'
      });
    }
    for (const k of unknowns) {
      evidence.push({
        source: `dodStewards.${k}`,
        snippet: 'unknown'
      });
    }
    const parts: string[] = [];
    if (reds.length > 0) parts.push(`${reds.length} red`);
    if (unknowns.length > 0) parts.push(`${unknowns.length} unknown`);
    return {
      ok: false,
      mode,
      reason: `DoD steward snapshot has ${parts.join(' + ')} of 4 stewards. Real-DoD requires all four green and fresh (<24h).`,
      suggestedFix: `Fix the failing steward${reds.length === 1 ? '' : 's'}: ${[...reds, ...unknowns].join(', ')}. Re-run the steward, refresh ctx.dodStewards.snapshotAt, and retry dispatch.`,
      evidence
    };
  }
};
