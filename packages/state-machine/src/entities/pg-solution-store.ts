import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client as PgClientCtor, Pool, PoolConfig } from 'pg';

import { DuplicateSolutionIdError } from './solution-errors.js';
import {
  ALL_SOLUTION_STATES,
  isSolutionState,
  isSolutionTerminal,
  SOLUTION_INITIAL_STATE,
  type SolutionState,
} from './solution-states.js';
import {
  availableSolutionTransitions,
  VALID_SOLUTION_TRANSITIONS,
} from './solution-transitions.js';
import type {
  SolutionAdvanceAtomicInput,
  SolutionAdvanceAtomicResult,
  SolutionStore,
  ListStuckOpts,
} from './solution-store.js';
import type {
  ApprovedPlanInput,
  SolutionActorKind,
  SolutionHistoryRow,
  SolutionRow,
  StuckSolution,
} from './solution-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadSolutionMigrationSql(): Promise<string> {
  const candidates = [
    join(__dirname, '..', '..', 'migrations', '0002_solution_lifecycle.sql'),
    join(__dirname, '..', '..', '..', 'migrations', '0002_solution_lifecycle.sql'),
    join(process.cwd(), 'migrations', '0002_solution_lifecycle.sql'),
  ];
  for (const path of candidates) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      // try next
    }
  }
  throw new Error(
    'cannot locate 0002_solution_lifecycle.sql — checked: ' + candidates.join(', '),
  );
}

export interface PgSolutionStoreOptions {
  /** Schema for the meta tables. Defaults to caia_meta. */
  schema?: string;
  /** Skip the bundled migration on init() — caller manages it elsewhere. */
  skipInit?: boolean;
}

/** Postgres-backed `SolutionStore`. Mirrors the project FSM's
 * `PgStateStore` — same advisory-lock / optimistic-version protocol
 * plus a LISTEN client for realtime. */
export class PgSolutionStore implements SolutionStore {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly skipInit: boolean;
  private listenClient: InstanceType<typeof PgClientCtor> | null = null;
  private listenHandlers = new Map<string, Set<(payload: string) => void>>();
  private listenStarting: Promise<void> | null = null;

  constructor(pool: Pool, opts: PgSolutionStoreOptions = {}) {
    this.pool = pool;
    this.schema = opts.schema ?? 'caia_meta';
    this.skipInit = opts.skipInit ?? false;
  }

  async init(): Promise<void> {
    if (this.skipInit) return;
    const sql = await loadSolutionMigrationSql();
    const final =
      this.schema === 'caia_meta'
        ? sql
        : sql.replace(/caia_meta\./g, `${this.schema}.`);
    await this.pool.query(final);
  }

  async reset(): Promise<void> {
    await this.pool.query(`
      TRUNCATE TABLE ${this.schema}.solution_history,
                     ${this.schema}.solution_lifecycle
        RESTART IDENTITY CASCADE
    `);
  }

  async registerSolution(input: ApprovedPlanInput, now: Date): Promise<SolutionRow> {
    const solutionId = input.solutionId ?? defaultSolutionId(now);
    const initialState = input.initialState ?? SOLUTION_INITIAL_STATE;
    const approvedAt = input.approvedAt ? new Date(input.approvedAt) : now;
    try {
      const r = await this.pool.query(
        `INSERT INTO ${this.schema}.solution_lifecycle
           (solution_id, title, plan_path, approved_by_adr, approved_at,
            status, status_since, current_payload, manifest_pointer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, '{}'::jsonb), $9)
         RETURNING *`,
        [
          solutionId,
          input.title,
          input.planPath ?? null,
          input.approvedByAdr ?? null,
          approvedAt.toISOString(),
          initialState,
          now.toISOString(),
          input.initialPayload ? JSON.stringify(input.initialPayload) : null,
          input.manifestPointer ?? null,
        ],
      );
      return rowToSolution(r.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DuplicateSolutionIdError(solutionId);
      }
      throw err;
    }
  }

  async getSolution(solutionId: string): Promise<SolutionRow | null> {
    const r = await this.pool.query(
      `SELECT * FROM ${this.schema}.solution_lifecycle WHERE solution_id = $1`,
      [solutionId],
    );
    if (r.rows.length === 0) return null;
    return rowToSolution(r.rows[0]);
  }

  async listActiveSolutions(): Promise<SolutionRow[]> {
    const r = await this.pool.query(
      `SELECT * FROM ${this.schema}.solution_lifecycle
        WHERE abandoned_at IS NULL AND done_at IS NULL`,
    );
    return r.rows.map(rowToSolution);
  }

  async setPaused(
    solutionId: string,
    by: string,
    now: Date,
  ): Promise<SolutionRow | null> {
    const r = await this.pool.query(
      `UPDATE ${this.schema}.solution_lifecycle
          SET paused = true,
              paused_at = $2,
              paused_by = $3,
              prior_state = CASE WHEN paused THEN prior_state ELSE status END,
              status = 'paused',
              status_since = $2,
              version = version + 1
        WHERE solution_id = $1
          AND done_at IS NULL
          AND abandoned_at IS NULL
        RETURNING *`,
      [solutionId, now.toISOString(), by],
    );
    if (r.rows.length === 0) return null;
    return rowToSolution(r.rows[0]);
  }

  async setResumed(solutionId: string, now: Date): Promise<SolutionRow | null> {
    const r = await this.pool.query(
      `UPDATE ${this.schema}.solution_lifecycle
          SET paused = false,
              paused_at = NULL,
              paused_by = NULL,
              status = COALESCE(prior_state, status),
              status_since = $2,
              prior_state = NULL,
              version = version + 1
        WHERE solution_id = $1
          AND paused = true
        RETURNING *`,
      [solutionId, now.toISOString()],
    );
    if (r.rows.length === 0) return null;
    return rowToSolution(r.rows[0]);
  }

  async advanceAtomic(
    input: SolutionAdvanceAtomicInput,
  ): Promise<SolutionAdvanceAtomicResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lockKey = `solution:${input.solutionId}`;
      const lockHash = hashToInt32(lockKey);
      const lockRes = await client.query(
        'SELECT pg_try_advisory_xact_lock($1) AS ok',
        [lockHash],
      );
      if (!lockRes.rows[0]?.ok) {
        await client.query('ROLLBACK');
        return { applied: false, newVersion: 0, historyId: null, idempotentReplay: false };
      }

      const dup = await client.query(
        `SELECT id FROM ${this.schema}.solution_history
          WHERE solution_id = $1 AND to_state = $2 AND payload_hash = $3
          LIMIT 1`,
        [input.solutionId, input.toState, input.payloadHash],
      );
      if (dup.rowCount && dup.rowCount > 0) {
        const cur = await client.query(
          `SELECT version FROM ${this.schema}.solution_lifecycle WHERE solution_id = $1`,
          [input.solutionId],
        );
        await client.query('COMMIT');
        return {
          applied: false,
          newVersion: cur.rows[0]?.version ?? 0,
          historyId: dup.rows[0].id,
          idempotentReplay: true,
        };
      }

      if (input.idempotencyWindowMs > 0) {
        const winSec = input.idempotencyWindowMs / 1000;
        const winDup = await client.query(
          `SELECT id FROM ${this.schema}.solution_history
            WHERE solution_id = $1
              AND to_state = $2
              AND payload_hash = $4
              AND at > now() - ($3 || ' seconds')::interval
            LIMIT 1`,
          [input.solutionId, input.toState, String(winSec), input.payloadHash],
        );
        if (winDup.rowCount && winDup.rowCount > 0) {
          const cur = await client.query(
            `SELECT version FROM ${this.schema}.solution_lifecycle WHERE solution_id = $1`,
            [input.solutionId],
          );
          await client.query('COMMIT');
          return {
            applied: false,
            newVersion: cur.rows[0]?.version ?? 0,
            historyId: winDup.rows[0].id,
            idempotentReplay: true,
          };
        }
      }

      const upd = await client.query(
        `UPDATE ${this.schema}.solution_lifecycle
            SET status = $2,
                status_since = $7::timestamptz,
                current_payload = $3,
                last_attestation = $4,
                version = version + 1,
                abandoned_at = CASE WHEN $2 = 'abandoned' THEN $7::timestamptz ELSE abandoned_at END,
                done_at      = CASE WHEN $2 = 'done'      THEN $7::timestamptz ELSE done_at END
          WHERE solution_id = $1
            AND version = $5
            AND status = $6
          RETURNING version`,
        [
          input.solutionId,
          input.toState,
          JSON.stringify(input.payload),
          JSON.stringify(input.attestation),
          input.expectedVersion,
          input.expectedStatus,
          input.now.toISOString(),
        ],
      );

      if (upd.rowCount === 0) {
        await client.query('ROLLBACK');
        return { applied: false, newVersion: 0, historyId: null, idempotentReplay: false };
      }

      const newVersion = upd.rows[0].version as number;

      const ins = await client.query(
        `INSERT INTO ${this.schema}.solution_history
           (solution_id, from_state, to_state, reason, actor_kind, actor_id,
            attestation, evidence, payload, payload_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (solution_id, to_state, payload_hash) DO NOTHING
         RETURNING id`,
        [
          input.solutionId,
          input.expectedStatus,
          input.toState,
          input.reason,
          input.actorKind,
          input.actorId,
          JSON.stringify(input.attestation),
          JSON.stringify(input.evidence),
          JSON.stringify(input.payload),
          input.payloadHash,
        ],
      );

      await client.query('COMMIT');
      return {
        applied: true,
        newVersion,
        historyId: ins.rows[0]?.id ?? null,
        idempotentReplay: false,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async listHistory(
    solutionId: string,
    opts: { limit?: number; afterId?: number; toState?: SolutionState } = {},
  ): Promise<SolutionHistoryRow[]> {
    const conds: string[] = ['solution_id = $1'];
    const params: unknown[] = [solutionId];
    if (opts.afterId !== undefined) {
      params.push(opts.afterId);
      conds.push(`id > $${params.length}`);
    }
    if (opts.toState) {
      params.push(opts.toState);
      conds.push(`to_state = $${params.length}`);
    }
    let sql = `SELECT * FROM ${this.schema}.solution_history WHERE ${conds.join(' AND ')} ORDER BY id ASC`;
    if (opts.limit !== undefined) {
      params.push(opts.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const r = await this.pool.query(sql, params);
    return r.rows.map(rowToHistory);
  }

  async listStuck(opts: ListStuckOpts): Promise<StuckSolution[]> {
    // Build a one-shot SQL using the in-memory thresholds. We compute the
    // age in SQL but compare against the per-state threshold via a CASE
    // expression so the query stays a single round-trip.
    const states = Object.keys(opts.thresholdsHours).filter((s) =>
      isSolutionState(s),
    ) as SolutionState[];
    if (states.length === 0) return [];

    // Defensive: only include non-terminal states (defaults already do this,
    // but operator may override).
    const validStates = states.filter((s) => !isSolutionTerminal(s));
    if (validStates.length === 0) return [];

    const cases = validStates
      .map((s, i) => `WHEN status = $${i + 1} THEN ${Number(opts.thresholdsHours[s])}`)
      .join('\n          ');
    const params: unknown[] = [...validStates, opts.now.toISOString()];

    const sql = `
      WITH thresholds AS (
        SELECT solution_id, status, status_since, paused, abandoned_at, done_at,
               (
                 CASE
                   ${cases}
                   ELSE NULL
                 END
               )::numeric AS threshold_hours,
               EXTRACT(EPOCH FROM ($${params.length}::timestamptz - status_since)) / 3600.0 AS age_hours
          FROM ${this.schema}.solution_lifecycle
         WHERE paused = false
           AND abandoned_at IS NULL
           AND done_at IS NULL
      )
      SELECT sl.*
        FROM ${this.schema}.solution_lifecycle sl
        JOIN thresholds t USING (solution_id)
       WHERE t.threshold_hours IS NOT NULL
         AND t.age_hours >= t.threshold_hours
       ORDER BY (t.age_hours - t.threshold_hours) DESC
    `;
    const r = await this.pool.query(sql, params);
    const nowMs = opts.now.getTime();
    return r.rows.map((row) => {
      const solution = rowToSolution(row);
      const threshold = opts.thresholdsHours[solution.status] ?? 0;
      const ageHours = (nowMs - solution.statusSince.getTime()) / 3_600_000;
      return {
        solution,
        ageHoursInState: ageHours,
        thresholdHours: threshold,
        nextExpectedState: deriveNextExpected(solution.status),
      };
    });
  }

  async subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    let set = this.listenHandlers.get(channel);
    if (!set) {
      set = new Set();
      this.listenHandlers.set(channel, set);
    }
    set.add(handler);
    await this.ensureListening(channel);
    return async () => {
      const s = this.listenHandlers.get(channel);
      if (s) {
        s.delete(handler);
        if (s.size === 0) {
          this.listenHandlers.delete(channel);
          if (this.listenClient) {
            try {
              await this.listenClient.query(`UNLISTEN ${escapeIdent(channel)}`);
            } catch {
              /* ignore */
            }
          }
        }
      }
    };
  }

  async closeListenClient(): Promise<void> {
    const client = this.listenClient;
    if (!client) return;
    this.listenClient = null;
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }

  private async ensureListening(channel: string): Promise<void> {
    if (this.listenStarting) {
      await this.listenStarting;
    }
    if (!this.listenClient) {
      this.listenStarting = this.startListenClient();
      await this.listenStarting;
      this.listenStarting = null;
    }
    if (!this.listenClient) throw new Error('solution listen client failed to start');
    await this.listenClient.query(`LISTEN ${escapeIdent(channel)}`);
  }

  private async startListenClient(): Promise<void> {
    const poolOpts = ((this.pool as unknown as { options?: PoolConfig }).options ?? {}) as PoolConfig;
    const { Client: PgClient } = await import('pg');
    const client = new PgClient(poolOpts);
    client.on('notification', (msg: import('pg').Notification) => {
      const ch = msg.channel;
      const set = this.listenHandlers.get(ch);
      if (!set) return;
      for (const h of [...set]) {
        try {
          h(msg.payload ?? '');
        } catch {
          /* ignore */
        }
      }
    });
    client.on('error', () => {
      this.listenClient = null;
    });
    await client.connect();
    this.listenClient = client;
  }
}

function rowToSolution(row: Record<string, unknown>): SolutionRow {
  const status = String(row.status);
  if (!isSolutionState(status)) {
    throw new Error(`bad solution status from db: ${status}`);
  }
  const prior = row.prior_state == null ? null : String(row.prior_state);
  if (prior !== null && !isSolutionState(prior)) {
    throw new Error(`bad solution prior_state from db: ${prior}`);
  }
  return {
    id: String(row.id),
    solutionId: String(row.solution_id),
    title: String(row.title),
    planPath: row.plan_path == null ? null : String(row.plan_path),
    approvedByAdr: row.approved_by_adr == null ? null : String(row.approved_by_adr),
    approvedAt: toDate(row.approved_at),
    status,
    statusSince: toDate(row.status_since),
    paused: Boolean(row.paused),
    pausedAt: row.paused_at == null ? null : toDate(row.paused_at),
    pausedBy: row.paused_by == null ? null : String(row.paused_by),
    priorState: prior as SolutionState | null,
    currentPayload: (row.current_payload as Record<string, unknown>) ?? {},
    lastAttestation: (row.last_attestation as Record<string, unknown>) ?? {},
    manifestPointer: row.manifest_pointer == null ? null : String(row.manifest_pointer),
    abandonedAt: row.abandoned_at == null ? null : toDate(row.abandoned_at),
    doneAt: row.done_at == null ? null : toDate(row.done_at),
    version: Number(row.version),
    createdAt: toDate(row.created_at),
  };
}

function rowToHistory(row: Record<string, unknown>): SolutionHistoryRow {
  const toState = String(row.to_state);
  if (!isSolutionState(toState)) throw new Error(`bad to_state from db: ${toState}`);
  const fromStateRaw = row.from_state == null ? null : String(row.from_state);
  if (fromStateRaw !== null && !isSolutionState(fromStateRaw)) {
    throw new Error(`bad from_state from db: ${fromStateRaw}`);
  }
  const actorKind = String(row.actor_kind);
  if (
    actorKind !== 'system' &&
    actorKind !== 'operator' &&
    actorKind !== 'agent' &&
    actorKind !== 'steward'
  ) {
    throw new Error(`bad actor_kind from db: ${actorKind}`);
  }
  return {
    id: Number(row.id),
    solutionId: String(row.solution_id),
    fromState: fromStateRaw as SolutionState | null,
    toState,
    reason: String(row.reason),
    actorKind: actorKind as SolutionActorKind,
    actorId: String(row.actor_id),
    attestation: (row.attestation as Record<string, unknown>) ?? {},
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    payload: (row.payload as Record<string, unknown>) ?? {},
    payloadHash: String(row.payload_hash),
    at: toDate(row.at),
  };
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  return new Date(String(v));
}

function escapeIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

function hashToInt32(s: string): number {
  const h = createHash('sha256').update(s).digest();
  return h.readInt32BE(0);
}

function isUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as { code?: unknown };
  return typeof e.code === 'string' && e.code === '23505';
}

function defaultSolutionId(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8);
  return `caia-${yyyy}-${mm}-${dd}-${rand}`;
}

function deriveNextExpected(current: SolutionState): SolutionState | null {
  const edges = availableSolutionTransitions(current);
  // unused vars elimination via reference (silences future lints if we add them)
  void ALL_SOLUTION_STATES;
  void VALID_SOLUTION_TRANSITIONS;
  for (const candidate of edges) {
    if (
      candidate !== 'paused' &&
      candidate !== 'abandoned' &&
      !candidate.endsWith('-failed') &&
      !candidate.endsWith('-rolled-back')
    ) {
      return candidate;
    }
  }
  return null;
}
