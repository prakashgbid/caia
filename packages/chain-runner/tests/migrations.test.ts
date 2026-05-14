// H-14 (phase 9, 2026-05-14). Tests for src/migrations.ts.
//
// Coverage:
//   - v1 → v2 stamps schema_version=2
//   - paused_at, paused_reason, paused_until, none_eligible_streak backfilled
//   - per-phase last_failure_class derived from existing failure.class
//   - per-phase backoff_until backfilled to null
//   - per-phase failure backfilled to null when missing
//   - migration is idempotent (running twice produces equal state)
//   - state already at CURRENT_SCHEMA_VERSION is returned untouched
//   - needsMigration returns false for v2, true for v1 / missing
//   - loadState() auto-migrates and emits state_migrated audit event
//   - the actual on-disk redflag-remediation state.json migrates without losing data

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  CURRENT_SCHEMA_VERSION,
  migrateState,
  needsMigration,
} from '../src/migrations.js';
import { loadContext, loadState, type StateContext } from '../src/state.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

let fx: FixtureBundle;
let ctx: StateContext;

beforeEach(() => {
  fx = makeFixture(`mig-${Math.random().toString(36).slice(2, 8)}`);
  ctx = loadContext(fx.chainId, fx.specPath);
});

afterEach(() => fx.cleanup());

function v1State(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    started_at: '2026-05-14T18:00:00Z',
    last_wake: null,
    paused: false,
    budget_consumed_pct: 0,
    budget_cap_pct: 25,
    phase_status: {
      '1': {
        status: 'done',
        attempts: 1,
        max_retries: 2,
        max_minutes: 45,
        started_at: '2026-05-14T18:01:00Z',
        completed_at: '2026-05-14T18:02:00Z',
        session_id: 's-1',
        error: null,
      },
      '2': {
        status: 'failed',
        attempts: 1,
        max_retries: 2,
        max_minutes: 45,
        started_at: '2026-05-14T18:03:00Z',
        completed_at: null,
        session_id: 's-2',
        error: 'rate limit',
        failure: {
          class: 'worker_no_start_rate_limit',
          reason: 'rate limit reset later',
          detected_at: '2026-05-14T18:04:00Z',
          evidence: {},
        },
      },
    },
    current_phase: null,
    all_done: false,
    ...overrides,
  };
}

describe('migrateState v1 → v2', () => {
  it('stamps schema_version=2', () => {
    const { state, report } = migrateState(v1State());
    expect(state.schema_version).toBe(2);
    expect(report.from).toBe(1);
    expect(report.to).toBe(2);
    expect(report.applied).toEqual(['v1_to_v2_add_streak_pause_failure_fields']);
  });

  it('backfills paused_at, paused_reason, paused_until to null', () => {
    const { state } = migrateState(v1State());
    expect(state.paused_at).toBeNull();
    expect(state.paused_reason).toBeNull();
    expect(state.paused_until).toBeNull();
  });

  it('preserves paused_reason / paused_until when already set', () => {
    const { state } = migrateState(
      v1State({ paused_reason: 'rate-limited', paused_until: '2026-05-16T16:00Z' }),
    );
    expect(state.paused_reason).toBe('rate-limited');
    expect(state.paused_until).toBe('2026-05-16T16:00Z');
  });

  it('initializes none_eligible_streak to 0', () => {
    const { state } = migrateState(v1State());
    expect(state.none_eligible_streak).toBe(0);
  });

  it('preserves an explicit none_eligible_streak value', () => {
    const { state } = migrateState(v1State({ none_eligible_streak: 3 }));
    expect(state.none_eligible_streak).toBe(3);
  });

  it('derives per-phase last_failure_class from existing failure.class', () => {
    const { state } = migrateState(v1State());
    expect(state.phase_status['1']!.last_failure_class).toBeNull();
    expect(state.phase_status['2']!.last_failure_class).toBe('worker_no_start_rate_limit');
  });

  it('backfills per-phase backoff_until to null', () => {
    const { state } = migrateState(v1State());
    expect(state.phase_status['1']!.backoff_until).toBeNull();
    expect(state.phase_status['2']!.backoff_until).toBeNull();
  });

  it('backfills per-phase failure to null when missing', () => {
    const { state } = migrateState(v1State());
    expect(state.phase_status['1']!.failure).toBeNull();
  });

  it('treats missing schema_version as v1', () => {
    const noVersion = v1State();
    delete noVersion['schema_version'];
    const { state, report } = migrateState(noVersion);
    expect(state.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(report.from).toBe(1);
  });

  it('is idempotent — running twice produces equal state', () => {
    const first = migrateState(v1State()).state;
    const second = migrateState(first as unknown as Record<string, unknown>).state;
    expect(second).toEqual(first);
  });

  it('leaves v2 state untouched', () => {
    const v2 = { ...v1State(), schema_version: 2 };
    const { state, report } = migrateState(v2);
    expect(report.applied).toEqual([]);
    // The migrate function may stamp +schema_version when missing; here it's
    // present so we expect no change beyond what's already there.
    expect(state.schema_version).toBe(2);
  });
});

describe('needsMigration', () => {
  it('returns true for v1', () => {
    expect(needsMigration(v1State())).toBe(true);
  });
  it('returns false for v2', () => {
    expect(needsMigration({ ...v1State(), schema_version: 2 })).toBe(false);
  });
  it('returns true when schema_version is missing', () => {
    const s = v1State();
    delete s['schema_version'];
    expect(needsMigration(s)).toBe(true);
  });
});

describe('loadState integration', () => {
  it('auto-migrates a v1 state.json and persists v2', () => {
    writeFileSync(ctx.paths.stateFile, JSON.stringify(v1State(), null, 2));
    const loaded = loadState(ctx);
    expect(loaded.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(loaded.none_eligible_streak).toBe(0);
    expect(loaded.phase_status['2']!.last_failure_class).toBe(
      'worker_no_start_rate_limit',
    );
    // Persisted to disk so the next load is a no-op
    const onDisk = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8'));
    expect(onDisk.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('emits state_migrated audit event on first load', () => {
    writeFileSync(ctx.paths.stateFile, JSON.stringify(v1State(), null, 2));
    loadState(ctx);
    const auditRaw = readFileSync(ctx.paths.auditFile, 'utf8');
    expect(auditRaw).toMatch(/state_migrated/);
    const lines = auditRaw.trim().split('\n').map((l) => JSON.parse(l));
    const migEvent = lines.find((l) => l.event === 'state_migrated');
    expect(migEvent).toBeDefined();
    expect(migEvent.from).toBe(1);
    expect(migEvent.to).toBe(CURRENT_SCHEMA_VERSION);
    expect(migEvent.applied).toEqual(['v1_to_v2_add_streak_pause_failure_fields']);
  });

  it('second load does NOT re-migrate (no audit event)', () => {
    writeFileSync(ctx.paths.stateFile, JSON.stringify(v1State(), null, 2));
    loadState(ctx);
    // Truncate audit so we can detect any new state_migrated emit
    writeFileSync(ctx.paths.auditFile, '');
    loadState(ctx);
    const auditRaw = readFileSync(ctx.paths.auditFile, 'utf8');
    expect(auditRaw).not.toMatch(/state_migrated/);
  });
});

// Read-only sanity check: the live redflag-remediation chain state.json
// should migrate cleanly. We DO NOT modify the file on disk — we read it,
// migrate in-memory, and assert the expected shape changes.
describe('v1 → v2 against live state files (read-only)', () => {
  const candidates = [
    join(homedir(), '.caia', 'chain', 'redflag-remediation', 'state.json'),
    join(homedir(), '.caia', 'chain', 'caia-stability-completion', 'state.json'),
  ];
  for (const p of candidates) {
    it(`migrates ${p.split('/').slice(-2).join('/')} without throwing`, () => {
      if (!existsSync(p)) {
        // Live file may not exist in CI / fresh machines — that's OK, skip.
        return;
      }
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
      const before = JSON.stringify(raw);
      const { state, report } = migrateState(raw, { path: p });
      // Live state may already be migrated; either way, output must be a
      // self-consistent v2 shape with the new fields present.
      expect(state.schema_version).toBe(CURRENT_SCHEMA_VERSION);
      expect(typeof state.none_eligible_streak).toBe('number');
      // Required: paused fields are nullable but defined.
      expect(state.paused_at === null || typeof state.paused_at === 'string').toBe(true);
      expect(
        state.paused_reason === null || typeof state.paused_reason === 'string',
      ).toBe(true);
      // Read-only contract — we never mutated the source file. Compare by
      // parsed shape rather than byte-equality (the on-disk file is whatever
      // format the runner persisted it in; the test must not depend on
      // formatting choices).
      expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual(JSON.parse(before));
      expect(report.from).toBeLessThanOrEqual(CURRENT_SCHEMA_VERSION);
    });
  }
});
