/**
 * Benchmark for @chiefaia/test-isolation/sqlite.
 *
 * Goal: per-test setup + cleanup must be cheap enough to use in every
 * test without blowing the test-suite wallclock. This runs as part of
 * `pnpm test` (vitest auto-discovers `*.bench.ts`) and emits a printable
 * report. We don't gate on absolute timing — too noisy across machines —
 * but a regression that pushes setup over 100 ms is something we want
 * to see in CI logs.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bench, describe } from 'vitest';
import { createTestDb } from '../src/sqlite.js';

let migrationsFolder: string;

function ensureFixtureMigrations(): string {
  if (migrationsFolder) return migrationsFolder;
  migrationsFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-migrations-'));
  fs.mkdirSync(path.join(migrationsFolder, 'meta'), { recursive: true });
  fs.writeFileSync(
    path.join(migrationsFolder, '0000_init.sql'),
    'CREATE TABLE thing (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
  );
  fs.writeFileSync(
    path.join(migrationsFolder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [{ idx: 0, version: '7', when: 0, tag: '0000_init', breakpoints: true }],
    }),
  );
  return migrationsFolder;
}

describe('createTestDb performance', () => {
  bench('create + cleanup (fresh migration)', () => {
    const t = createTestDb({ migrationsFolder: ensureFixtureMigrations() });
    t.cleanup();
  });

  bench('create + 10 inserts + cleanup', () => {
    const t = createTestDb({ migrationsFolder: ensureFixtureMigrations() });
    const stmt = t.sqlite.prepare('INSERT INTO thing (name) VALUES (?)');
    for (let i = 0; i < 10; i++) stmt.run(`row-${i}`);
    t.cleanup();
  });
});
