/**
 * Minimal pg surface we depend on. Defining it here (instead of importing
 * `pg.Pool` directly) lets unit tests inject a hand-rolled mock without
 * pulling the real driver into the test fixture.
 *
 * The shape exactly matches what we use from `pg.Pool` / `pg.Client`:
 *   - `query(text, values)` returning rows + rowCount
 *   - `connect()` returning a `PoolClientLike` for transactional work
 *
 * Production wiring passes `new pg.Pool({...})` directly; the shape is
 * structurally compatible.
 */

export interface QueryResultLike<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}

export interface PoolClientLike {
  query<R = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResultLike<R>>;
  release(): void;
}

export interface PoolLike {
  query<R = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResultLike<R>>;
  connect?(): Promise<PoolClientLike>;
}
