/**
 * Tiny in-memory pg.Pool mock for hermetic unit tests.
 *
 * NOT a real Postgres — it doesn't execute SQL. It records every
 * (query, params) call and replays handler responses configured by
 * the test. The runner's "did this migration apply?" question is
 * checked at the call-sequence level (e.g. "the tracker INSERT
 * happened after the migration query") rather than via real DDL.
 *
 * The integration suite (`tests/integration/`) is where real Postgres
 * semantics are verified.
 */

import type { PgPoolLike } from '../src/types.js';

export interface RecordedQuery {
  text: string;
  params: ReadonlyArray<unknown>;
}

export type QueryHandler = (
  text: string,
  params: ReadonlyArray<unknown>,
) => { rows: unknown[]; rowCount: number | null } | Promise<{ rows: unknown[]; rowCount: number | null }>;

export interface MockPool extends PgPoolLike {
  readonly calls: RecordedQuery[];
  /** Push a handler — first matching pattern wins, FIFO. */
  on(pattern: string | RegExp, handler: QueryHandler): void;
  /** Set the default response when no on() pattern matches. */
  default(handler: QueryHandler): void;
  /** Replace the entire call log (mostly for assertions). */
  reset(): void;
}

const EMPTY = { rows: [] as unknown[], rowCount: 0 as number | null };

export function makeMockPool(): MockPool {
  const handlers: Array<{ match: (t: string) => boolean; fn: QueryHandler }> = [];
  let defaultHandler: QueryHandler = () => EMPTY;
  const calls: RecordedQuery[] = [];

  const pool: MockPool = {
    calls,
    on(pattern, fn) {
      const match =
        pattern instanceof RegExp
          ? (t: string) => pattern.test(t)
          : (t: string) => t.includes(pattern);
      handlers.push({ match, fn });
    },
    default(fn) {
      defaultHandler = fn;
    },
    reset() {
      calls.length = 0;
      handlers.length = 0;
      defaultHandler = () => EMPTY;
    },
    async query<R = Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: R[]; rowCount: number | null }> {
      const p = params ?? [];
      calls.push({ text, params: p });
      for (const h of handlers) {
        if (h.match(text)) {
          const r = await h.fn(text, p);
          return { rows: r.rows as R[], rowCount: r.rowCount };
        }
      }
      const r = await defaultHandler(text, p);
      return { rows: r.rows as R[], rowCount: r.rowCount };
    },
  };

  return pool;
}

/** Convenience: in-memory state machine for the _migrations_applied table. */
export function makeTrackerState(): {
  read: (pkg: string, file: string) => { checksum: string } | null;
  write: (pkg: string, file: string, checksum: string) => void;
  size: () => number;
  rows: Map<string, { checksum: string }>;
} {
  const rows = new Map<string, { checksum: string }>();
  return {
    rows,
    read: (pkg, file) => rows.get(`${pkg}::${file}`) ?? null,
    write: (pkg, file, checksum) => {
      rows.set(`${pkg}::${file}`, { checksum });
    },
    size: () => rows.size,
  };
}
