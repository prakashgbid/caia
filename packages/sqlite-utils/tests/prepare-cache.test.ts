import { describe, expect, it } from 'vitest';

import { openDb } from '../src/open.js';
import {
  prepareCachedStmt,
  clearPreparedStmtCache,
  preparedStmtCacheSize,
} from '../src/prepare-cache.js';

describe('prepareCachedStmt', () => {
  it('returns the same Statement instance for the same SQL', () => {
    const db = openDb(':memory:');
    try {
      db.exec('CREATE TABLE t (x INTEGER PRIMARY KEY)');
      const a = prepareCachedStmt(db, 'INSERT INTO t (x) VALUES (?)');
      const b = prepareCachedStmt(db, 'INSERT INTO t (x) VALUES (?)');
      expect(a).toBe(b);
    } finally {
      db.close();
    }
  });

  it('different SQL → different Statement', () => {
    const db = openDb(':memory:');
    try {
      db.exec('CREATE TABLE t (x INTEGER, y INTEGER)');
      const a = prepareCachedStmt(db, 'SELECT x FROM t');
      const b = prepareCachedStmt(db, 'SELECT y FROM t');
      expect(a).not.toBe(b);
    } finally {
      db.close();
    }
  });

  it('different DB → separate caches', () => {
    const db1 = openDb(':memory:');
    const db2 = openDb(':memory:');
    try {
      db1.exec('CREATE TABLE t (x INTEGER)');
      db2.exec('CREATE TABLE t (x INTEGER)');
      const sql = 'SELECT x FROM t';
      const a = prepareCachedStmt(db1, sql);
      const b = prepareCachedStmt(db2, sql);
      expect(a).not.toBe(b);
    } finally {
      db1.close();
      db2.close();
    }
  });

  it('the cached statement works for run/get/all', () => {
    const db = openDb(':memory:');
    try {
      db.exec('CREATE TABLE t (x INTEGER PRIMARY KEY)');
      const insert = prepareCachedStmt<[number]>(db, 'INSERT INTO t (x) VALUES (?)');
      insert.run(1);
      insert.run(2);
      const select = prepareCachedStmt<[], { x: number }>(db, 'SELECT x FROM t ORDER BY x');
      const rows = select.all() as Array<{ x: number }>;
      expect(rows.map((r) => r.x)).toEqual([1, 2]);
    } finally {
      db.close();
    }
  });

  it('preparedStmtCacheSize reports per-DB statement count', () => {
    const db = openDb(':memory:');
    try {
      db.exec('CREATE TABLE t (x INTEGER, y INTEGER)');
      expect(preparedStmtCacheSize(db)).toBe(0);
      prepareCachedStmt(db, 'SELECT x FROM t');
      expect(preparedStmtCacheSize(db)).toBe(1);
      prepareCachedStmt(db, 'SELECT y FROM t');
      expect(preparedStmtCacheSize(db)).toBe(2);
      // Re-prepare same SQL doesn't grow the cache.
      prepareCachedStmt(db, 'SELECT x FROM t');
      expect(preparedStmtCacheSize(db)).toBe(2);
    } finally {
      db.close();
    }
  });

  it('clearPreparedStmtCache drops all statements for the DB', () => {
    const db = openDb(':memory:');
    try {
      db.exec('CREATE TABLE t (x INTEGER, y INTEGER)');
      prepareCachedStmt(db, 'SELECT x FROM t');
      prepareCachedStmt(db, 'SELECT y FROM t');
      expect(preparedStmtCacheSize(db)).toBe(2);
      const dropped = clearPreparedStmtCache(db);
      expect(dropped).toBe(2);
      expect(preparedStmtCacheSize(db)).toBe(0);
      // Calling again on an empty cache returns 0.
      expect(clearPreparedStmtCache(db)).toBe(0);
    } finally {
      db.close();
    }
  });
});
