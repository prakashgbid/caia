/**
 * Structural Postgres-pool typing for `@caia/design-ingest`.
 *
 * We re-declare here (rather than re-export from snapshotter) so callers
 * that want a tighter type surface than `pg.Pool` can pin to this
 * package without dragging the snapshotter's full type tree along.
 *
 * Shape is intentionally identical to
 * `@caia/atlas-design-snapshotter`'s `PoolLike`, so a single test
 * double satisfies both — see `FakePool` in `tests/helpers/fake-pg.ts`.
 */

export interface QueryResultLike<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number;
}

export interface PoolClientLike {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<R>>;
  release(): void;
}

export interface PoolLike {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<R>>;
  connect(): Promise<PoolClientLike>;
}
