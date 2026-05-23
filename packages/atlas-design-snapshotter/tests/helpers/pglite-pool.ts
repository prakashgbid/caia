/**
 * Wrap a `PGlite` in-process Postgres instance behind the `PoolLike`
 * interface the snapshotter consumes. Lets the integration test exercise
 * the real SQL path (real planner, real JSONB, real transactions) without
 * needing Docker on the host.
 *
 * Notes:
 *   - PGlite is single-process so "concurrent" connect() calls share the
 *     same backing process; transactions still work correctly.
 *   - PGlite does not ship pgcrypto in the default build — we load it
 *     via the `@electric-sql/pglite/contrib/pgcrypto` extension so
 *     `gen_random_uuid()` works.
 *   - PGlite returns dates as Date objects when read via the row interface,
 *     and JSONB as parsed JS values.
 */

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { PoolLike, PoolClientLike, QueryResultLike } from '../../src/pg-types.js';

export class PGlitePool implements PoolLike {
  private constructor(private readonly db: PGlite) {}

  static async create(): Promise<PGlitePool> {
    const db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    return new PGlitePool(db);
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async query<R = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResultLike<R>> {
    const res = await this.db.query<R>(sql, params);
    return {
      rows: (res.rows as R[]) ?? [],
      rowCount: typeof res.affectedRows === 'number' ? res.affectedRows : (res.rows?.length ?? 0),
    };
  }

  async connect(): Promise<PoolClientLike> {
    const self = this;
    return {
      async query<R = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<QueryResultLike<R>> {
        return self.query<R>(sql, params);
      },
      release() {
        /* no-op */
      },
    };
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
