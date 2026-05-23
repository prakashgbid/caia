/**
 * Structural Postgres-pool typing. Mirrors `secrets-postgres/pg-types.ts`
 * so the snapshotter accepts a `pg.Pool` or a test double without a hard
 * dependency on `pg`'s class shape.
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
