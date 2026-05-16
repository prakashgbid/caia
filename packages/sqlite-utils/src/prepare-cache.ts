/**
 * `prepareCachedStmt` — memoised `db.prepare(sql)`.
 *
 * Most consumers in caia today already cache prepared statements at
 * class construction time (mentor-event-bus, llm-cache, local-rag,
 * mentor-retrieval all build their own `private readonly insertStmt
 * = this.db.prepare(...)` constellation). That pattern is fine when
 * the call sites are stable, but it forces a class around the DB
 * handle for what is otherwise a thin functional surface.
 *
 * `prepareCachedStmt` lets functional consumers get the same hot-path
 * win (prepare is O(parse + plan); cached lookups are O(1)) without
 * building a class. Internally it stores a WeakMap keyed by the DB
 * handle, then a Map keyed by the SQL string. The WeakMap means the
 * cache is automatically released when the DB is GC'd — no leak risk
 * for short-lived in-memory test DBs.
 *
 * Caveat: only use this for compile-time-known SQL strings. Don't pass
 * runtime-interpolated SQL through it — that would (a) trivially blow
 * the cache up to infinity, and (b) probably mean you should be using
 * `db.prepare(...)` with named parameters anyway.
 */

import type { Database as DatabaseInstance, Statement } from 'better-sqlite3';

type StmtCache = Map<string, Statement>;

// WeakMap: when the Database handle is GC'd (close() called, no refs
// remaining), the per-DB statement Map is collectable too. This is the
// shape librarian + mentor-event-bus would have built in-class anyway,
// just lifted out of the class scope.
const cachePerDb = new WeakMap<DatabaseInstance, StmtCache>();

/**
 * Return a prepared statement for `sql` against `db`. The same SQL
 * string returns the same `Statement` instance for the lifetime of the
 * database handle.
 *
 * @example
 * ```ts
 * import { openDb, prepareCachedStmt } from '@chiefaia/sqlite-utils';
 *
 * const db = openDb('cache.sqlite');
 * const get = prepareCachedStmt<{ hash: string }, { payload: string }>(
 *   db,
 *   'SELECT payload FROM exact WHERE hash = @hash',
 * );
 * const row = get.get({ hash: '...' });
 * ```
 *
 * @typeParam P - Parameters type bound by your call site's named-params shape.
 * @typeParam R - Row type the statement yields.
 *
 * @remarks
 * - Do NOT pass user-controlled SQL. The cache grows unboundedly per
 *   distinct SQL string; user-tainted SQL is also a classic injection
 *   surface that this helper does nothing to prevent.
 * - If you truly need to drop a specific cache entry (e.g. a test
 *   re-creates the schema mid-suite), call `clearPreparedStmtCache(db)`
 *   to drop the whole DB-level cache. Statement-level eviction is not
 *   exposed by design — the right pattern is to recreate the DB.
 */
export function prepareCachedStmt<P = unknown, R = unknown>(
  db: DatabaseInstance,
  sql: string,
): Statement<[P], R> {
  let perDb = cachePerDb.get(db);
  if (!perDb) {
    perDb = new Map<string, Statement>();
    cachePerDb.set(db, perDb);
  }
  const cached = perDb.get(sql);
  if (cached) {
    return cached as unknown as Statement<[P], R>;
  }
  const fresh = db.prepare(sql) as unknown as Statement<[P], R>;
  perDb.set(sql, fresh as unknown as Statement);
  return fresh;
}

/**
 * Drop every cached statement for `db`. Use only when the schema has
 * been replaced and a stale prepared statement would reference dropped
 * columns. In production code this should be very rare — the right
 * answer is almost always to open a new DB handle.
 *
 * Returns the number of statements evicted (zero if no cache existed).
 */
export function clearPreparedStmtCache(db: DatabaseInstance): number {
  const perDb = cachePerDb.get(db);
  if (!perDb) return 0;
  const n = perDb.size;
  perDb.clear();
  cachePerDb.delete(db);
  return n;
}

/**
 * Test-only: how many statements are currently cached for `db`?
 * Exported so consumers + this package's tests can assert the
 * memoisation contract without poking at module-private state.
 */
export function preparedStmtCacheSize(db: DatabaseInstance): number {
  return cachePerDb.get(db)?.size ?? 0;
}
