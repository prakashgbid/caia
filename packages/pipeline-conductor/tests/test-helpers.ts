/**
 * In-memory mock Pool that records every query and replies from a queued
 * fixture stack. Lets us write deterministic unit tests without a live PG.
 */

import type { QueryResult, QueryResultRow } from 'pg';

export interface MockQueryCall {
  sql: string;
  params: unknown[];
}

export type Responder<T extends QueryResultRow = QueryResultRow> = (
  sql: string,
  params: unknown[],
) => Partial<QueryResult<T>> | undefined;

export class MockPool {
  public calls: MockQueryCall[] = [];
  private responders: Responder[] = [];

  /**
   * Register a responder. The responder is only invoked if the SQL matches
   * the pattern. Tried in registration order; first non-undefined match wins.
   *
   * - Pass a row array → returned wrapped in { rows, rowCount } when pattern matches.
   * - Pass a function (sql, params) → fn(sql, params) is called only when pattern matches.
   */
  on<T extends QueryResultRow = QueryResultRow>(
    pattern: RegExp | string,
    rowsOrFn: T[] | Responder<T>,
  ): void {
    const matcher = typeof pattern === 'string'
      ? (sql: string): boolean => sql.includes(pattern)
      : (sql: string): boolean => pattern.test(sql);

    const responder: Responder<T> = (sql, params) => {
      if (!matcher(sql)) return undefined;
      if (typeof rowsOrFn === 'function') {
        return (rowsOrFn as Responder<T>)(sql, params);
      }
      return { rows: rowsOrFn, rowCount: rowsOrFn.length };
    };
    this.responders.push(responder as Responder);
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    this.calls.push({ sql, params });
    for (const r of this.responders) {
      const out = r(sql, params);
      if (out !== undefined) {
        return {
          rows: (out.rows ?? []) as T[],
          rowCount: out.rowCount ?? out.rows?.length ?? 0,
          command: out.command ?? 'SELECT',
          oid: out.oid ?? 0,
          fields: out.fields ?? [],
        } as QueryResult<T>;
      }
    }
    // Default: empty rowset (so missing fixtures don't throw).
    return {
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as QueryResult<T>;
  }

  async end(): Promise<void> {
    return;
  }

  reset(): void {
    this.calls = [];
    this.responders = [];
  }

  callsMatching(pattern: RegExp | string): MockQueryCall[] {
    const matcher = typeof pattern === 'string'
      ? (sql: string): boolean => sql.includes(pattern)
      : (sql: string): boolean => pattern.test(sql);
    return this.calls.filter((c) => matcher(c.sql));
  }
}
