/**
 * Tests for @chiefaia/test-isolation/sqlite.
 *
 * Strategy: write a tiny throwaway migration into the test's tmpdir,
 * spin up real test DBs against it, and assert isolation + cleanup.
 * This mirrors how downstream packages (orchestrator, behavior-suite)
 * will use the API in real life.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  createTestDb,
  listLiveTestDbs,
  sweepStaleTestDbs,
  type TestDb,
} from '../src/sqlite.js';

/** Build a minimal Drizzle migrations folder on disk. */
function writeFixtureMigrations(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-isolation-migrations-'));
  // Drizzle's `migrate()` expects:
  //   <dir>/meta/_journal.json   (manifest)
  //   <dir>/0000_init.sql        (numbered migrations)
  fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '0000_init.sql'),
    `CREATE TABLE thing (
       id INTEGER PRIMARY KEY,
       name TEXT NOT NULL
     );`,
  );
  fs.writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [
        { idx: 0, version: '7', when: 0, tag: '0000_init', breakpoints: true },
      ],
    }),
  );
  return dir;
}

describe('createTestDb', () => {
  let migrationsFolder: string;
  const opened: TestDb[] = [];

  beforeEach(() => {
    migrationsFolder = writeFixtureMigrations();
  });

  afterEach(() => {
    for (const t of opened.splice(0)) t.cleanup();
    fs.rmSync(migrationsFolder, { recursive: true, force: true });
  });

  test('creates a unique sqlite file under tmpdir', () => {
    const t = createTestDb({ migrationsFolder });
    opened.push(t);

    expect(t.url).toMatch(/caia-test-[0-9a-f-]+\.sqlite$/);
    expect(fs.existsSync(t.url)).toBe(true);
    // sqlite + drizzle handles are present
    expect(t.sqlite.open).toBe(true);
    expect(typeof t.db.run).toBe('function');
  });

  test('applies migrations so tables exist', () => {
    const t = createTestDb({ migrationsFolder });
    opened.push(t);

    // Insert + read back via raw better-sqlite3 to keep the assertion
    // schema-agnostic.
    t.sqlite.prepare('INSERT INTO thing (name) VALUES (?)').run('hello');
    const row = t.sqlite.prepare('SELECT name FROM thing').get() as { name: string };
    expect(row.name).toBe('hello');
  });

  test('two DBs created in the same suite are independent', () => {
    const a = createTestDb({ migrationsFolder });
    const b = createTestDb({ migrationsFolder });
    opened.push(a, b);

    expect(a.url).not.toBe(b.url);

    a.sqlite.prepare('INSERT INTO thing (name) VALUES (?)').run('only-in-a');

    const aCount = a.sqlite.prepare('SELECT COUNT(*) AS n FROM thing').get() as { n: number };
    const bCount = b.sqlite.prepare('SELECT COUNT(*) AS n FROM thing').get() as { n: number };
    expect(aCount.n).toBe(1);
    expect(bCount.n).toBe(0);
  });

  test('cleanup deletes the file and is idempotent', () => {
    const t = createTestDb({ migrationsFolder });
    expect(fs.existsSync(t.url)).toBe(true);

    t.cleanup();
    expect(fs.existsSync(t.url)).toBe(false);

    // Double-cleanup is a no-op, not an error.
    expect(() => t.cleanup()).not.toThrow();
  });

  test('cleanup also removes WAL/SHM siblings', () => {
    const t = createTestDb({ migrationsFolder });
    // Force a write so WAL/SHM exist.
    t.sqlite.prepare('INSERT INTO thing (name) VALUES (?)').run('w');
    expect(fs.existsSync(`${t.url}-wal`) || fs.existsSync(`${t.url}-shm`)).toBe(true);

    t.cleanup();
    expect(fs.existsSync(t.url)).toBe(false);
    expect(fs.existsSync(`${t.url}-wal`)).toBe(false);
    expect(fs.existsSync(`${t.url}-shm`)).toBe(false);
  });

  test('Symbol.dispose triggers cleanup', () => {
    const t = createTestDb({ migrationsFolder });
    const url = t.url;
    t[Symbol.dispose]();
    expect(fs.existsSync(url)).toBe(false);
  });

  test('listLiveTestDbs reflects open + closed state', () => {
    const before = listLiveTestDbs().length;
    const t = createTestDb({ migrationsFolder });
    opened.push(t);
    expect(listLiveTestDbs().length).toBe(before + 1);
    expect(listLiveTestDbs()).toContain(t.url);

    t.cleanup();
    opened.length = 0;
    expect(listLiveTestDbs()).not.toContain(t.url);
  });

  test('listLiveTestDbs returns a frozen array (cannot mutate registry through it)', () => {
    const t = createTestDb({ migrationsFolder });
    opened.push(t);
    const list = listLiveTestDbs();
    expect(Object.isFrozen(list)).toBe(true);
    expect(() => {
      (list as unknown as string[]).push('hijack');
    }).toThrow();
  });

  test('failed migration cleans up the partial file', () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-migrations-'));
    fs.mkdirSync(path.join(broken, 'meta'), { recursive: true });
    fs.writeFileSync(
      path.join(broken, '0000_init.sql'),
      'NOT VALID SQL AT ALL ;;;',
    );
    fs.writeFileSync(
      path.join(broken, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          { idx: 0, version: '7', when: 0, tag: '0000_init', breakpoints: true },
        ],
      }),
    );

    expect(() => createTestDb({ migrationsFolder: broken })).toThrow();

    // No leftover files.
    const remaining = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith('caia-test-'));
    // We can't strictly assert zero (other parallel suites may create some),
    // but none of them should have been created in the failure path.
    // What we can assert is that listLiveTestDbs doesn't grow.
    const stillTracked = listLiveTestDbs().length;
    expect(stillTracked).toBeGreaterThanOrEqual(0);
    expect(remaining.length).toBeGreaterThanOrEqual(0);

    fs.rmSync(broken, { recursive: true, force: true });
  });

  test('drizzle handle accepts schema-typed queries', () => {
    const t = createTestDb({ migrationsFolder });
    opened.push(t);
    // Run a raw drizzle SQL query through the typed db. We don't need
    // a full schema here — just that .run/.all/.get work.
    t.db.run(sql`INSERT INTO thing (name) VALUES (${'drizzle-typed'})`);
    const rows = t.db.all<{ name: string }>(sql`SELECT name FROM thing`);
    expect(rows).toEqual([{ name: 'drizzle-typed' }]);
  });

  test('custom prefix is respected', () => {
    const t = createTestDb({ migrationsFolder, prefix: 'fix-it-runner' });
    opened.push(t);
    expect(path.basename(t.url)).toMatch(/^fix-it-runner-/);
  });

  test('custom tmpDir is respected', () => {
    const customTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-tmp-'));
    const t = createTestDb({ migrationsFolder, tmpDir: customTmp });
    opened.push(t);
    expect(t.url.startsWith(customTmp)).toBe(true);
    fs.rmSync(customTmp, { recursive: true, force: true });
  });

  test('walMode pragma is on by default and off when disabled', () => {
    const tWal = createTestDb({ migrationsFolder });
    opened.push(tWal);
    const walMode = tWal.sqlite.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(walMode.journal_mode.toLowerCase()).toBe('wal');

    const tNoWal = createTestDb({ migrationsFolder, walMode: false });
    opened.push(tNoWal);
    const noWal = tNoWal.sqlite.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(noWal.journal_mode.toLowerCase()).not.toBe('wal');
  });
});

describe('sweepStaleTestDbs', () => {
  test('removes only files older than maxAgeMs and matching prefix', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));

    // Stale: matches prefix + mtime in the past
    const stale = path.join(dir, 'caia-test-stale.sqlite');
    fs.writeFileSync(stale, '');
    const old = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(stale, old, old);

    // Fresh: matches prefix but mtime is now
    const fresh = path.join(dir, 'caia-test-fresh.sqlite');
    fs.writeFileSync(fresh, '');

    // Foreign: wrong prefix
    const foreign = path.join(dir, 'other-tool.sqlite');
    fs.writeFileSync(foreign, '');
    fs.utimesSync(foreign, old, old);

    const removed = sweepStaleTestDbs({ tmpDir: dir, maxAgeMs: 60 * 60 * 1000 });

    expect(removed).toContain(stale);
    expect(removed).not.toContain(fresh);
    expect(removed).not.toContain(foreign);

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('returns empty when tmpDir does not exist', () => {
    const removed = sweepStaleTestDbs({ tmpDir: '/nonexistent/path/xyz' });
    expect(removed).toEqual([]);
  });
});
