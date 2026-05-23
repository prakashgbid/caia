import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client as PgClientCtor, Pool, PoolConfig } from 'pg';

import { isProjectState, type ProjectState } from './states.js';
import type {
  StateStore,
  TransitionAtomicInput,
  TransitionAtomicResult,
} from './store.js';
import type {
  ActorKind,
  ClaimResult,
  JanitorResult,
  NewProjectInput,
  ProjectRow,
  StateTransitionRow,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadMigrationSql(): Promise<string> {
  const candidates = [
    join(__dirname, '..', 'migrations', '0001_state_machine.sql'),
    join(__dirname, '..', '..', 'migrations', '0001_state_machine.sql'),
    join(process.cwd(), 'migrations', '0001_state_machine.sql'),
  ];
  for (const path of candidates) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      // try next
    }
  }
  throw new Error(
    'cannot locate 0001_state_machine.sql - checked: ' + candidates.join(', '),
  );
}

export interface PgStateStoreOptions {
  /** Schema for the meta tables. Defaults to caia_meta. */
  schema?: string;
  /** When you already manage migrations elsewhere, pass `skipInit: true` so init() is a no-op. */
  skipInit?: boolean;
}

/**
 * Postgres-backed StateStore. Owns ONE `pg.Pool` for queries; a
 * separate dedicated `Client` is opened lazily for LISTEN.
 */
export class PgStateStore implements StateStore {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly skipInit: boolean;
  private listenClient: InstanceType<typeof PgClientCtor> | null = null;
  private listenHandlers = new Map<string, Set<(payload: string) => void>>();
  private listenStarting: Promise<void> | null = null;

  constructor(pool: Pool, opts: PgStateStoreOptions = {}) {
    this.pool = pool;
    this.schema = opts.schema ?? 'caia_meta';
    this.skipInit = opts.skipInit ?? false;
  }

  async init(): Promise<void> {
    if (this.skipInit) return;
    const sql = await loadMigrationSql();
    const final =
      this.schema === 'caia_meta'
        ? sql
        : sql.replace(/caia_meta\./g, `${this.schema}.`);
    await this.pool.query(final);
  }

  async reset(): Promise<void> {
    await this.pool.query(`
      TRUNCATE TABLE ${this.schema}.state_history,
                     ${this.schema}.ticket_claims,
                     ${this.schema}.tenant_projects
        RESTART IDENTITY CASCADE
    `);
  }

  async createProject(input: NewProjectInput): Promise<ProjectRow> {
    const sql = `
      INSERT INTO ${this.schema}.tenant_projects
        (id, tenant_id, slug, display_name, status, current_payload, parent_project_id)
      VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, COALESCE($5, 'onboarding'), COALESCE($6, '{}'::jsonb), $7)
      RETURNING *
    `;
    const r = await this.pool.query(sql, [
      input.id ?? null,
      input.tenantId,
      input.slug,
      input.displayName,
      input.initialState ?? null,
      input.initialPayload ? JSON.stringify(input.initialPayload) : null,
      input.parentProjectId ?? null,
    ]);
    return rowToProject(r.rows[0]);
  }

  async getProject(projectId: string): Promise<ProjectRow | null> {
    const r = await this.pool.query(
      `SELECT * FROM ${this.schema}.tenant_projects WHERE id = $1`,
      [projectId],
    );
    if (r.rows.length === 0) return null;
    return rowToProject(r.rows[0]);
  }

  async listActiveProjects(): Promise<ProjectRow[]> {
    const r = await this.pool.query(
      `SELECT * FROM ${this.schema}.tenant_projects WHERE archived_at IS NULL`,
    );
    return r.rows.map(rowToProject);
  }

  async setPaused(
    projectId: string,
    paused: boolean,
    by: string | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.schema}.tenant_projects
          SET paused = $2,
              paused_at = CASE WHEN $2 THEN now() ELSE NULL END,
              paused_by = CASE WHEN $2 THEN $3 ELSE NULL END
        WHERE id = $1`,
      [projectId, paused, by],
    );
  }

  async transitionAtomic(
    input: TransitionAtomicInput,
  ): Promise<TransitionAtomicResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lockKey = `project:${input.projectId}`;
      const lockHash = hashToInt32(lockKey);
      const lockRes = await client.query(
        'SELECT pg_try_advisory_xact_lock($1) AS ok',
        [lockHash],
      );
      if (!lockRes.rows[0]?.ok) {
        await client.query('ROLLBACK');
        return { applied: false, newVersion: 0, historyId: null };
      }

      const dup = await client.query(
        `SELECT id FROM ${this.schema}.state_history
          WHERE project_id = $1 AND to_state = $2 AND payload_hash = $3
          LIMIT 1`,
        [input.projectId, input.toState, input.payloadHash],
      );
      if (dup.rowCount && dup.rowCount > 0) {
        const cur = await client.query(
          `SELECT version FROM ${this.schema}.tenant_projects WHERE id = $1`,
          [input.projectId],
        );
        await client.query('COMMIT');
        return {
          applied: false,
          newVersion: cur.rows[0]?.version ?? 0,
          historyId: dup.rows[0].id,
        };
      }

      if (input.idempotencyWindowMs > 0) {
        const winSec = input.idempotencyWindowMs / 1000;
        const winDup = await client.query(
          `SELECT id FROM ${this.schema}.state_history
            WHERE project_id = $1
              AND to_state = $2
              AND payload_hash = $4
              AND at > now() - ($3 || ' seconds')::interval
            LIMIT 1`,
          [input.projectId, input.toState, String(winSec), input.payloadHash],
        );
        if (winDup.rowCount && winDup.rowCount > 0) {
          const cur = await client.query(
            `SELECT version FROM ${this.schema}.tenant_projects WHERE id = $1`,
            [input.projectId],
          );
          await client.query('COMMIT');
          return {
            applied: false,
            newVersion: cur.rows[0]?.version ?? 0,
            historyId: winDup.rows[0].id,
          };
        }
      }

      const upd = await client.query(
        `UPDATE ${this.schema}.tenant_projects
            SET status = $2,
                current_payload = $3,
                last_transitioned_at = now(),
                last_transitioned_by = $4,
                version = version + 1,
                archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE archived_at END
          WHERE id = $1
            AND version = $5
            AND status = $6
          RETURNING version`,
        [
          input.projectId,
          input.toState,
          JSON.stringify(input.payload),
          input.actorId,
          input.expectedVersion,
          input.expectedStatus,
        ],
      );

      if (upd.rowCount === 0) {
        await client.query('ROLLBACK');
        return { applied: false, newVersion: 0, historyId: null };
      }

      const newVersion = upd.rows[0].version as number;

      const ins = await client.query(
        `INSERT INTO ${this.schema}.state_history
           (project_id, from_state, to_state, reason, actor_kind, actor_id, agent_run_id, payload, payload_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (project_id, to_state, payload_hash) DO NOTHING
         RETURNING id`,
        [
          input.projectId,
          input.expectedStatus,
          input.toState,
          input.reason,
          input.actorKind,
          input.actorId,
          input.agentRunId,
          JSON.stringify(input.payload),
          input.payloadHash,
        ],
      );

      await client.query('COMMIT');
      return {
        applied: true,
        newVersion,
        historyId: ins.rows[0]?.id ?? null,
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
    projectId: string,
    opts: { limit?: number; afterId?: number; toState?: ProjectState } = {},
  ): Promise<StateTransitionRow[]> {
    const conds: string[] = ['project_id = $1'];
    const params: unknown[] = [projectId];
    if (opts.afterId !== undefined) {
      params.push(opts.afterId);
      conds.push(`id > $${params.length}`);
    }
    if (opts.toState) {
      params.push(opts.toState);
      conds.push(`to_state = $${params.length}`);
    }
    let sql = `SELECT * FROM ${this.schema}.state_history WHERE ${conds.join(' AND ')} ORDER BY id ASC`;
    if (opts.limit !== undefined) {
      params.push(opts.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const r = await this.pool.query(sql, params);
    return r.rows.map(rowToHistory);
  }

  async tryClaim(input: {
    ticketId: string;
    projectId: string | null;
    agentId: string;
    ttlSeconds: number;
    now: Date;
  }): Promise<ClaimResult> {
    const sql = `
      INSERT INTO ${this.schema}.ticket_claims
        (ticket_id, project_id, claimed_by, claimed_at, heartbeat_at, ttl_seconds, version)
      VALUES ($1, $2, $3, $4, $4, $5, 1)
      ON CONFLICT (ticket_id) DO UPDATE
        SET claimed_by = EXCLUDED.claimed_by,
            claimed_at = EXCLUDED.claimed_at,
            heartbeat_at = EXCLUDED.heartbeat_at,
            ttl_seconds = EXCLUDED.ttl_seconds,
            final_status = NULL,
            final_at = NULL,
            project_id = COALESCE(${this.schema}.ticket_claims.project_id, EXCLUDED.project_id),
            version = ${this.schema}.ticket_claims.version + 1
        WHERE ${this.schema}.ticket_claims.claimed_by IS NULL
           OR ${this.schema}.ticket_claims.claimed_by = EXCLUDED.claimed_by
           OR ${this.schema}.ticket_claims.heartbeat_at < EXCLUDED.heartbeat_at - (${this.schema}.ticket_claims.ttl_seconds || ' seconds')::interval
      RETURNING claimed_by, heartbeat_at, ttl_seconds
    `;
    const r = await this.pool.query(sql, [
      input.ticketId,
      input.projectId,
      input.agentId,
      input.now.toISOString(),
      input.ttlSeconds,
    ]);
    if (r.rowCount === 0 || !r.rows[0]) {
      return { claimed: false, ttl: input.ttlSeconds };
    }
    const row = r.rows[0];
    return {
      claimed: row.claimed_by === input.agentId,
      ttl: row.ttl_seconds,
      claimedBy: row.claimed_by,
      heartbeatAt: row.heartbeat_at,
    };
  }

  async heartbeat(input: {
    ticketId: string;
    agentId: string;
    now: Date;
  }): Promise<{ ok: boolean; heartbeatAt: Date | null }> {
    const r = await this.pool.query(
      `UPDATE ${this.schema}.ticket_claims
          SET heartbeat_at = $3
        WHERE ticket_id = $1 AND claimed_by = $2
        RETURNING heartbeat_at`,
      [input.ticketId, input.agentId, input.now.toISOString()],
    );
    if (r.rowCount === 0 || !r.rows[0])
      return { ok: false, heartbeatAt: null };
    return { ok: true, heartbeatAt: r.rows[0].heartbeat_at };
  }

  async releaseClaim(input: {
    ticketId: string;
    agentId: string;
    finalStatus: string;
    now: Date;
  }): Promise<{ ok: boolean }> {
    const r = await this.pool.query(
      `UPDATE ${this.schema}.ticket_claims
          SET claimed_by = NULL,
              claimed_at = NULL,
              heartbeat_at = NULL,
              final_status = $3,
              final_at = $4
        WHERE ticket_id = $1 AND claimed_by = $2
        RETURNING 1`,
      [input.ticketId, input.agentId, input.finalStatus, input.now.toISOString()],
    );
    return { ok: (r.rowCount ?? 0) > 0 };
  }

  async janitorSweep(now: Date): Promise<JanitorResult> {
    const r = await this.pool.query(
      `UPDATE ${this.schema}.ticket_claims
          SET claimed_by = NULL,
              claimed_at = NULL,
              heartbeat_at = NULL,
              final_status = 'stale',
              final_at = $1
        WHERE claimed_by IS NOT NULL
          AND heartbeat_at < $1::timestamptz - (ttl_seconds || ' seconds')::interval
        RETURNING ticket_id`,
      [now.toISOString()],
    );
    return { releasedClaims: r.rows.map((row: { ticket_id: string }) => row.ticket_id) };
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
    if (!this.listenClient) throw new Error('listen client failed to start');
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

  async notify(channel: string, payload: string): Promise<void> {
    await this.pool.query('SELECT pg_notify($1, $2)', [channel, payload]);
  }
}

function rowToProject(row: Record<string, unknown>): ProjectRow {
  const status = String(row.status);
  if (!isProjectState(status)) {
    throw new Error(`bad status from db: ${status}`);
  }
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    status,
    paused: Boolean(row.paused),
    pausedAt:
      row.paused_at instanceof Date
        ? row.paused_at
        : row.paused_at
          ? new Date(String(row.paused_at))
          : null,
    pausedBy: row.paused_by != null ? String(row.paused_by) : null,
    currentPayload: (row.current_payload as Record<string, unknown>) ?? {},
    lastTransitionedAt:
      row.last_transitioned_at instanceof Date
        ? row.last_transitioned_at
        : new Date(String(row.last_transitioned_at)),
    lastTransitionedBy: String(row.last_transitioned_by),
    parentProjectId:
      row.parent_project_id != null ? String(row.parent_project_id) : null,
    archivedAt:
      row.archived_at instanceof Date
        ? row.archived_at
        : row.archived_at
          ? new Date(String(row.archived_at))
          : null,
    version: Number(row.version),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at
        : new Date(String(row.created_at)),
  };
}

function rowToHistory(row: Record<string, unknown>): StateTransitionRow {
  const toState = String(row.to_state);
  if (!isProjectState(toState))
    throw new Error(`bad to_state from db: ${toState}`);
  const fromState = row.from_state != null ? String(row.from_state) : null;
  if (fromState !== null && !isProjectState(fromState)) {
    throw new Error(`bad from_state from db: ${fromState}`);
  }
  const actorKind = String(row.actor_kind);
  if (actorKind !== 'system' && actorKind !== 'operator' && actorKind !== 'agent') {
    throw new Error(`bad actor_kind from db: ${actorKind}`);
  }
  return {
    id: Number(row.id),
    projectId: String(row.project_id),
    fromState: fromState as ProjectState | null,
    toState,
    reason: String(row.reason),
    actorKind: actorKind as ActorKind,
    actorId: String(row.actor_id),
    agentRunId: row.agent_run_id != null ? String(row.agent_run_id) : null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    at: row.at instanceof Date ? row.at : new Date(String(row.at)),
    payloadHash: String(row.payload_hash),
  };
}

function escapeIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

function hashToInt32(s: string): number {
  const h = createHash('sha256').update(s).digest();
  return h.readInt32BE(0);
}
