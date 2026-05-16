import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../src/open.js';
import {
  migrate,
  isMigrationsInitialised,
  listAppliedMigrations,
} from '../src/migrate.js';

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'sqlite-utils-migrate-'));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function seedMigrations(dir: string, files: Record<string, string>): string {
  const m = join(dir, 'migrations');
  mkdirSync(m, { recursive: true });
  for (const [f, sql] of Object.entries(files)) {
    writeFileSync(join(m, f), sql, 'utf-8');
  }
  return m;
}

describe('migrate', () => {
  it('applies every file once', () => {
    const dir = seedMigrations(workDir, {
      '0001_init.sql': 'CREATE TABLE a (x INTEGER PRIMARY KEY);',
      '0002_more.sql': 'CREATE TABLE b (y INTEGER PRIMARY KEY);',
    });
    const db = openDb(':memory:');
    try {
      const report = migrate(db, dir);
      expect(report.applied).toEqual(['0001_init.sql', '0002_more.sql']);
      expect(report.skipped).toEqual([]);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toEqual(['_migrations', 'a', 'b']);
    } finally {
      db.close();
    }
  });

  it('is idempotent on re-run', () => {
    const dir = seedMigrations(workDir, {
      '0001_init.sql': 'CREATE TABLE a (x INTEGER PRIMARY KEY);',
    });
    const db = openDb(':memory:');
    try {
      const first = migrate(db, dir);
      expect(first.applied).toEqual(['0001_init.sql']);
      const second = migrate(db, dir);
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(['0001_init.sql']);
    } finally {
      db.close();
    }
  });

  it('applies new files added between runs', () => {
    const dir = seedMigrations(workDir, {
      '0001_init.sql': 'CREATE TABLE a (x INTEGER PRIMARY KEY);',
    });
    const db = openDb(':memory:');
    try {
      migrate(db, dir);
      // Add a second migration
      writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE b (y INTEGER PRIMARY KEY);', 'utf-8');
      const r = migrate(db, dir);
      expect(r.applied).toEqual(['0002_b.sql']);
      expect(r.skipped).toEqual(['0001_init.sql']);
    } finally {
      db.close();
    }
  });

  it('runs files in lexicographic order', () => {
    const dir = seedMigrations(workDir, {
      '0002_b.sql': 'INSERT INTO _audit VALUES (2);',
      '0001_a.sql': 'CREATE TABLE _audit (x INTEGER); INSERT INTO _audit VALUES (1);',
      '0003_c.sql': 'INSERT INTO _audit VALUES (3);',
    });
    const db = openDb(':memory:');
    try {
      migrate(db, dir);
      const rows = db.prepare('SELECT x FROM _audit ORDER BY rowid').all() as Array<{ x: number }>;
      expect(rows.map((r) => r.x)).toEqual([1, 2, 3]);
    } finally {
      db.close();
    }
  });

  it('rolls back on failure and does not mark the bad file applied', () => {
    const dir = seedMigrations(workDir, {
      '0001_ok.sql': 'CREATE TABLE good (x INTEGER PRIMARY KEY);',
      '0002_bad.sql': 'NOT VALID SQL;',
    });
    const db = openDb(':memory:');
    try {
      expect(() => migrate(db, dir)).toThrow();
      expect(listAppliedMigrations(db)).toEqual(['0001_ok.sql']);
      // good table exists; bad never ran
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toEqual(['_migrations', 'good']);
    } finally {
      db.close();
    }
  });

  it('treats missing migrationsDir as a no-op', () => {
    const db = openDb(':memory:');
    try {
      const r = migrate(db, join(workDir, 'does-not-exist'));
      expect(r).toEqual({ considered: [], applied: [], skipped: [] });
      expect(isMigrationsInitialised(db)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('only=[files] restricts the candidate set', () => {
    const dir = seedMigrations(workDir, {
      '0001_a.sql': 'CREATE TABLE a (x INTEGER PRIMARY KEY);',
      '0002_b.sql': 'CREATE TABLE b (y INTEGER PRIMARY KEY);',
    });
    const db = openDb(':memory:');
    try {
      const r = migrate(db, dir, { only: ['0001_a.sql'] });
      expect(r.applied).toEqual(['0001_a.sql']);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toEqual(['_migrations', 'a']);
    } finally {
      db.close();
    }
  });

  it('isMigrationsInitialised returns false before first call', () => {
    const db = openDb(':memory:');
    try {
      expect(isMigrationsInitialised(db)).toBe(false);
      const dir = seedMigrations(workDir, {});
      migrate(db, dir);
      expect(isMigrationsInitialised(db)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('listAppliedMigrations returns chronological order', () => {
    const dir = seedMigrations(workDir, {
      '0001_a.sql': 'CREATE TABLE a (x INTEGER PRIMARY KEY);',
      '0002_b.sql': 'CREATE TABLE b (y INTEGER PRIMARY KEY);',
    });
    const db = openDb(':memory:');
    try {
      migrate(db, dir);
      expect(listAppliedMigrations(db)).toEqual(['0001_a.sql', '0002_b.sql']);
    } finally {
      db.close();
    }
  });

  it('honours custom trackingTable', () => {
    const dir = seedMigrations(workDir, {
      '0001_a.sql': 'CREATE TABLE a (x INTEGER PRIMARY KEY);',
    });
    const db = openDb(':memory:');
    try {
      migrate(db, dir, { trackingTable: '_mig_custom' });
      expect(isMigrationsInitialised(db, '_mig_custom')).toBe(true);
      expect(isMigrationsInitialised(db, '_migrations')).toBe(false);
      expect(listAppliedMigrations(db, '_mig_custom')).toEqual(['0001_a.sql']);
    } finally {
      db.close();
    }
  });

  it('skips non-.sql files', () => {
    const dir = seedMigrations(workDir, {
      '0001_init.sql': 'CREATE TABLE a (x INTEGER PRIMARY KEY);',
      'README.md': 'do not run',
      '0002_more.txt': 'INVALID;',
    });
    const db = openDb(':memory:');
    try {
      const r = migrate(db, dir);
      expect(r.applied).toEqual(['0001_init.sql']);
    } finally {
      db.close();
    }
  });
});
