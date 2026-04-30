/**
 * SAFETY-004 — SQLite-backed CapStore + RecordSink for the spend-guard.
 *
 * Uses better-sqlite3 (already a transitive dep). All writes are inside
 * a single transaction so the read-modify-write contract holds under
 * concurrent callers.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  SpendCapSchema,
  SpendRecordSchema,
  type CapStore,
  type SpendRecordSink,
  type SpendCap,
  type SpendCapScope,
  type SpendRecord,
} from '@chiefaia/spend-guard';

export class SqliteCapStore implements CapStore {
  constructor(private readonly db: Database.Database) {}

  async getOrCreate(opts: {
    scope: SpendCapScope;
    resourceId: string;
    defaultLimitUsd: number;
    defaultPeriodSec: number;
    nowMs: number;
  }): Promise<SpendCap> {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT scope, resource_id, period_sec, limit_usd, current_usd, last_reset_ms_epoch, locked_until_ms_epoch
             FROM spend_caps WHERE scope = ? AND resource_id = ?`,
        )
        .get(opts.scope, opts.resourceId) as
        | {
            scope: string;
            resource_id: string;
            period_sec: number;
            limit_usd: number;
            current_usd: number;
            last_reset_ms_epoch: number;
            locked_until_ms_epoch: number | null;
          }
        | undefined;

      if (row) {
        return SpendCapSchema.parse({
          scope: row.scope,
          resourceId: row.resource_id,
          periodSec: row.period_sec,
          limitUsd: row.limit_usd,
          currentUsd: row.current_usd,
          lastResetMsEpoch: row.last_reset_ms_epoch,
          lockedUntilMsEpoch: row.locked_until_ms_epoch,
        });
      }
      const fresh = SpendCapSchema.parse({
        scope: opts.scope,
        resourceId: opts.resourceId,
        periodSec: opts.defaultPeriodSec,
        limitUsd: opts.defaultLimitUsd,
        currentUsd: 0,
        lastResetMsEpoch: opts.nowMs,
        lockedUntilMsEpoch: null,
      });
      this.db
        .prepare(
          `INSERT INTO spend_caps (scope, resource_id, period_sec, limit_usd, current_usd, last_reset_ms_epoch, locked_until_ms_epoch)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          fresh.scope,
          fresh.resourceId,
          fresh.periodSec,
          fresh.limitUsd,
          fresh.currentUsd,
          fresh.lastResetMsEpoch,
          fresh.lockedUntilMsEpoch,
        );
      return fresh;
    });
    return Promise.resolve(tx());
  }

  async put(cap: SpendCap): Promise<void> {
    const parsed = SpendCapSchema.parse(cap);
    this.db
      .prepare(
        `INSERT INTO spend_caps (scope, resource_id, period_sec, limit_usd, current_usd, last_reset_ms_epoch, locked_until_ms_epoch)
           VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope, resource_id) DO UPDATE SET
           period_sec = excluded.period_sec,
           limit_usd = excluded.limit_usd,
           current_usd = excluded.current_usd,
           last_reset_ms_epoch = excluded.last_reset_ms_epoch,
           locked_until_ms_epoch = excluded.locked_until_ms_epoch`,
      )
      .run(
        parsed.scope,
        parsed.resourceId,
        parsed.periodSec,
        parsed.limitUsd,
        parsed.currentUsd,
        parsed.lastResetMsEpoch,
        parsed.lockedUntilMsEpoch,
      );
  }

  async list(): Promise<readonly SpendCap[]> {
    const rows = this.db
      .prepare(
        `SELECT scope, resource_id, period_sec, limit_usd, current_usd, last_reset_ms_epoch, locked_until_ms_epoch FROM spend_caps`,
      )
      .all() as Array<{
        scope: string;
        resource_id: string;
        period_sec: number;
        limit_usd: number;
        current_usd: number;
        last_reset_ms_epoch: number;
        locked_until_ms_epoch: number | null;
      }>;
    return rows.map((r) =>
      SpendCapSchema.parse({
        scope: r.scope,
        resourceId: r.resource_id,
        periodSec: r.period_sec,
        limitUsd: r.limit_usd,
        currentUsd: r.current_usd,
        lastResetMsEpoch: r.last_reset_ms_epoch,
        lockedUntilMsEpoch: r.locked_until_ms_epoch,
      }),
    );
  }
}

export class SqliteRecordSink implements SpendRecordSink {
  constructor(private readonly db: Database.Database) {}

  async append(record: SpendRecord): Promise<void> {
    const parsed = SpendRecordSchema.parse({
      ...record,
      id: record.id ?? randomUUID(),
    });
    this.db
      .prepare(
        `INSERT INTO spend_records (id, task_id, project_id, agent_role, model, via, account_id, input_tokens, output_tokens, cost_usd, ts_ms_epoch)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.id,
        parsed.taskId,
        parsed.projectId,
        parsed.agentRole,
        parsed.model,
        parsed.via,
        parsed.accountId,
        parsed.inputTokens,
        parsed.outputTokens,
        parsed.costUsd,
        parsed.tsMsEpoch,
      );
  }

  /** Sum cost over a time window — used by the dashboard widget. */
  sumCostUsd(opts: { sinceMsEpoch: number; untilMsEpoch?: number }): number {
    const until = opts.untilMsEpoch ?? Date.now();
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend_records WHERE ts_ms_epoch >= ? AND ts_ms_epoch < ?`,
      )
      .get(opts.sinceMsEpoch, until) as { total: number };
    return row.total;
  }
}
