/**
 * `withTransaction` — run `fn` inside a SQLite transaction.
 *
 * Thin wrapper over better-sqlite3's `db.transaction(fn)()` builder. The
 * wrapper exists for three reasons:
 *
 *   1. Better-sqlite3's API is "build a transaction function, then call
 *      it." Most consumers don't need the intermediate function and end
 *      up writing `db.transaction(() => {...})()` — the trailing `()` is
 *      the easiest part of better-sqlite3 to forget. `withTransaction`
 *      collapses it to one call.
 *
 *   2. Better-sqlite3's transaction wrapper is SYNCHRONOUS. Passing an
 *      async function to `db.transaction()` silently fails (the function
 *      runs, the transaction commits immediately, the rest of your
 *      async work happens outside the transaction). We re-export the
 *      same sync contract and make it explicit in the type signature so
 *      a future `await db.run()` mistake fails at compile time.
 *
 *   3. The `mode` parameter (`'deferred' | 'immediate' | 'exclusive'`)
 *      is occasionally needed by the librarian Phase-2 reader concurrency
 *      tests. Exposed here so callers don't need to remember which
 *      better-sqlite3 helper to reach for.
 */

import type { Database as DatabaseInstance, Transaction } from 'better-sqlite3';

/**
 * SQLite transaction modes. See https://www.sqlite.org/lang_transaction.html
 * - `deferred`  (default): lock acquired lazily on first write.
 * - `immediate`: write lock acquired immediately at BEGIN time. Use when
 *   you need to ensure no other writer can start mid-transaction.
 * - `exclusive`: exclusive lock — no other connection may read or write.
 *   Rarely needed (only when a VACUUM or schema-altering op is involved).
 */
export type TransactionMode = 'deferred' | 'immediate' | 'exclusive';

export interface WithTransactionOptions {
  /** SQLite begin-mode. Default: `'deferred'`. */
  mode?: TransactionMode;
}

/**
 * Run `fn` inside a SQLite transaction. Returns whatever `fn` returns.
 *
 * If `fn` throws, the transaction rolls back and the error is re-thrown
 * unchanged — callers see the same exception they would have seen from
 * a direct `db.transaction(fn)()` call.
 *
 * MUST be synchronous: if you pass an `async` function, the transaction
 * commits before the promise resolves and any DB work scheduled after
 * an `await` happens outside the transaction. The TypeScript signature
 * forbids this at compile time (R is constrained to non-Promise).
 *
 * @example
 * ```ts
 * import { openDb, withTransaction } from '@chiefaia/sqlite-utils';
 *
 * const db = openDb('events.sqlite');
 * const offset = withTransaction(db, () => {
 *   db.prepare('UPDATE counter SET v = v + 1').run();
 *   const { v } = db.prepare('SELECT v FROM counter').get() as { v: number };
 *   return v;
 * });
 * ```
 *
 * @example Immediate-mode for concurrent-writer scenarios
 * ```ts
 * withTransaction(db, () => { ... }, { mode: 'immediate' });
 * ```
 */
export function withTransaction<R>(
  db: DatabaseInstance,
  fn: () => R extends Promise<unknown> ? never : R,
  opts: WithTransactionOptions = {},
): R {
  // better-sqlite3 returns a callable wrapper. The `.deferred` / `.immediate`
  // / `.exclusive` properties on that wrapper switch the begin-mode.
  const tx = db.transaction(fn) as Transaction<() => R>;
  switch (opts.mode) {
    case 'immediate':
      return tx.immediate();
    case 'exclusive':
      return tx.exclusive();
    case 'deferred':
    case undefined:
      return tx();
    default: {
      // Exhaustiveness — protects against a future `mode` value being added.
      const _exhaustive: never = opts.mode;
      throw new Error(`unknown transaction mode: ${String(_exhaustive)}`);
    }
  }
}
