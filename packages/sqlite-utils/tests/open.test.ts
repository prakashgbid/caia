import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../src/open.js';

const created: string[] = [];
function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-utils-open-'));
  created.push(dir);
  return join(dir, 'sub', 'test.sqlite');
}

afterEach(() => {
  while (created.length) {
    const d = created.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('openDb', () => {
  it('opens a fresh db file and creates the parent dir', () => {
    const path = tmpDb();
    expect(existsSync(path)).toBe(false);
    const db = openDb(path);
    try {
      expect(existsSync(path)).toBe(true);
      // WAL mode default
      const mode = db.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
      // FK on
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);
      // synchronous = NORMAL (1) when WAL is on
      const sync = db.pragma('synchronous', { simple: true });
      expect(sync).toBe(1);
    } finally {
      db.close();
    }
  });

  it(':memory: skips WAL and disk-only behaviour', () => {
    const db = openDb(':memory:');
    try {
      const mode = db.pragma('journal_mode', { simple: true });
      // in-memory default is 'memory'
      expect(mode).toBe('memory');
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);
    } finally {
      db.close();
    }
  });

  it('honours wal=false to keep DELETE journal mode', () => {
    const path = tmpDb();
    const db = openDb(path, { wal: false });
    try {
      const mode = db.pragma('journal_mode', { simple: true });
      expect(mode).toBe('delete');
    } finally {
      db.close();
    }
  });

  it('honours foreignKeys=false', () => {
    const path = tmpDb();
    const db = openDb(path, { foreignKeys: false });
    try {
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(0);
    } finally {
      db.close();
    }
  });

  it('honours synchronousNormal=false', () => {
    const path = tmpDb();
    const db = openDb(path, { synchronousNormal: false });
    try {
      // SQLite default when not set explicitly with WAL is FULL (2)
      const sync = db.pragma('synchronous', { simple: true });
      expect(sync).toBe(2);
    } finally {
      db.close();
    }
  });

  it('readonly mode skips writable pragmas and refuses writes', () => {
    const path = tmpDb();
    const writer = openDb(path);
    try {
      writer.exec('CREATE TABLE t (x INTEGER PRIMARY KEY)');
      writer.prepare('INSERT INTO t (x) VALUES (?)').run(1);
    } finally {
      writer.close();
    }
    const reader = openDb(path, { readonly: true });
    try {
      const row = reader.prepare('SELECT x FROM t').get() as { x: number };
      expect(row.x).toBe(1);
      expect(() => reader.exec('INSERT INTO t (x) VALUES (2)')).toThrow();
    } finally {
      reader.close();
    }
  });

  it('passes betterSqlite3 options through (timeout)', () => {
    const path = tmpDb();
    const db = openDb(path, { betterSqlite3: { timeout: 1234 } });
    try {
      // No public getter for timeout, but the call should not throw
      // and the DB should be usable.
      db.exec('CREATE TABLE t (x INTEGER)');
    } finally {
      db.close();
    }
  });
});
