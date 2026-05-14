// H-14 (chain-runner-battle-harden phase 9, 2026-05-14). State schema
// versioning. Existing state.json files were written with schema_version=1
// before phase 5 introduced fields like `none_eligible_streak`, `paused_at`,
// `paused_reason`, `last_failure_class`, `backoff_until`, and
// `heartbeat_grace_sec`. Those phases added the fields opportunistically
// (with `?` optional in the TS types) and let runtime promote them as state
// got re-saved. That worked for the harden chain itself but is fragile —
// a fresh load of an unmigrated file by a code path that DIDN'T touch one
// of those fields would silently leave it `undefined`.
//
// The migration registry below is the explicit, single-source-of-truth path
// for evolving the on-disk shape:
//
//   1. read state.json
//   2. examine schema_version (treat missing as 1)
//   3. walk the registry from <current> → SCHEMA_VERSION, applying each
//      registered transformer in order
//   4. stamp the new schema_version and persist
//   5. emit a `state_migrated` audit event with the path delta
//
// Each migration is PURE: it accepts the prior shape, returns the next shape.
// Side-effects (saveState, audit emit) live in loadState. Migrations MUST be
// idempotent — applying them twice produces the same state — so an
// interrupted migration that lands a partial write can be re-run safely.
//
// Risk model: the v1→v2 migration only ADDS fields with safe defaults. No
// renames, no deletions, no semantic flips. Older code that reads a v2 file
// will see the new fields and either pick them up or ignore them; older code
// is also forward-compatible because the new fields are all marked optional
// in TS.

import type { StateFile } from './types.js';

/** Source-of-truth for the current on-disk schema. Read by state.ts. */
export const CURRENT_SCHEMA_VERSION = 2;

export interface MigrationContext {
  /** Originating filesystem path (informational; used in audit). */
  path?: string;
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: string[];
  changes: string[];
}

/** Internal — a single (from → to) transformer. */
interface Migration {
  from: number;
  to: number;
  name: string;
  migrate(state: Record<string, unknown>, ctx: MigrationContext): {
    state: Record<string, unknown>;
    changes: string[];
  };
}

// ---------------------------------------------------------------------------
// v1 → v2 — paused_at, paused_reason, none_eligible_streak, last_failure_class,
// auto_resolve_hung_post_success (phase opt-in), acceptance_enforce (phase +
// chain opt-in).
//
// All fields default to the safe pre-H-14 behavior:
//   paused_at: null
//   paused_reason: null (preserves the H-4b value when already populated)
//   none_eligible_streak: 0
//   per PhaseState.last_failure_class: derived from existing failure.class
//   per PhaseState.backoff_until: null
//   per PhaseState.heartbeat_grace_sec: preserved when set; otherwise omitted
//     (lock.ts falls back to lock.HEARTBEAT_GRACE_SEC for legacy entries)
//   per PhaseState.auto_resolve_hung_post_success: not stamped here — it is
//     a phase-spec-level opt-in (PhaseDefinition / chain_config), not a
//     per-state field, so the migration is a noop for it. Documented in this
//     comment so the migration scope is explicit.
//   acceptance_enforce: same — phase-spec / chain_config, not state.
// ---------------------------------------------------------------------------
const migrateV1ToV2: Migration = {
  from: 1,
  to: 2,
  name: 'v1_to_v2_add_streak_pause_failure_fields',
  migrate(stateRaw, _ctx) {
    const state = { ...stateRaw } as Record<string, unknown>;
    const changes: string[] = [];

    // Top-level fields.
    if (state['paused_at'] === undefined) {
      state['paused_at'] = null;
      changes.push('+paused_at=null');
    }
    if (state['paused_reason'] === undefined) {
      state['paused_reason'] = null;
      changes.push('+paused_reason=null');
    }
    if (state['paused_until'] === undefined) {
      state['paused_until'] = null;
      changes.push('+paused_until=null');
    }
    if (state['none_eligible_streak'] === undefined) {
      state['none_eligible_streak'] = 0;
      changes.push('+none_eligible_streak=0');
    }

    // Per-phase normalization. We only touch fields that became part of the
    // documented contract in v2; everything else passes through unchanged.
    const ps = state['phase_status'];
    if (ps && typeof ps === 'object' && !Array.isArray(ps)) {
      const psObj = ps as Record<string, Record<string, unknown>>;
      for (const [phaseId, entry] of Object.entries(psObj)) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry['last_failure_class'] === undefined) {
          const failure = entry['failure'] as
            | { class?: unknown }
            | null
            | undefined;
          if (
            failure &&
            typeof failure === 'object' &&
            typeof failure.class === 'string'
          ) {
            entry['last_failure_class'] = failure.class;
            changes.push(
              `phase_${phaseId}.+last_failure_class=${failure.class}`,
            );
          } else {
            entry['last_failure_class'] = null;
            changes.push(`phase_${phaseId}.+last_failure_class=null`);
          }
        }
        if (entry['backoff_until'] === undefined) {
          entry['backoff_until'] = null;
          changes.push(`phase_${phaseId}.+backoff_until=null`);
        }
        if (entry['failure'] === undefined) {
          entry['failure'] = null;
          changes.push(`phase_${phaseId}.+failure=null`);
        }
        // heartbeat_grace_sec is deliberately NOT stamped on legacy entries —
        // checkLockStaleness falls back to lock.HEARTBEAT_GRACE_SEC for
        // undefined, which preserves pre-H-11 behavior. The first save after
        // resolveHeartbeatGrace runs will populate it on a clean boundary.
      }
    }

    state['schema_version'] = 2;
    return { state, changes };
  },
};

const MIGRATIONS: Migration[] = [migrateV1ToV2];

/**
 * Run any registered migrations whose `from` version is reached by the input
 * state. Returns the migrated state, the chain of migration names applied,
 * and a flat list of human-readable changes (used by the audit event).
 *
 * When the input state has no `schema_version` field it is treated as v1.
 *
 * When the input is already at CURRENT_SCHEMA_VERSION (or beyond — possible
 * if state was written by a newer binary that was rolled back), no migrations
 * apply and the input is returned untouched (well — schema_version may be
 * stamped if missing).
 */
export function migrateState(
  stateRaw: Record<string, unknown>,
  ctx: MigrationContext = {},
): { state: StateFile; report: MigrationReport } {
  let current = stateRaw;
  const incomingVersion =
    typeof current['schema_version'] === 'number'
      ? (current['schema_version'] as number)
      : 1;
  const applied: string[] = [];
  const changes: string[] = [];
  let version = incomingVersion;
  // Walk the chain. The registry is small (1 entry today) but loop is
  // future-proof: any future migration just appends to MIGRATIONS.
  // Defensive: max 100 hops to guard against accidental loops.
  for (let i = 0; i < 100 && version < CURRENT_SCHEMA_VERSION; i++) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      throw new Error(
        `state schema v${version} has no migration to v${version + 1}; registry must be updated before bumping CURRENT_SCHEMA_VERSION`,
      );
    }
    const r = step.migrate(current, ctx);
    current = r.state;
    applied.push(step.name);
    changes.push(...r.changes);
    version = step.to;
  }
  // If the state had no schema_version but was already at the current shape
  // (e.g., a brand-new buildInitialState that pre-dated this migration code),
  // stamp it once.
  if (typeof current['schema_version'] !== 'number') {
    current['schema_version'] = CURRENT_SCHEMA_VERSION;
    changes.push(`+schema_version=${CURRENT_SCHEMA_VERSION}`);
  }
  return {
    state: current as unknown as StateFile,
    report: {
      from: incomingVersion,
      to: CURRENT_SCHEMA_VERSION,
      applied,
      changes,
    },
  };
}

/** Read-only check: did migration actually change anything? Cheap to call. */
export function needsMigration(stateRaw: Record<string, unknown>): boolean {
  const v =
    typeof stateRaw['schema_version'] === 'number'
      ? (stateRaw['schema_version'] as number)
      : 1;
  return v < CURRENT_SCHEMA_VERSION;
}
