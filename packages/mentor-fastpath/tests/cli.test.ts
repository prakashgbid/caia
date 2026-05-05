/**
 * CLI tests — exercise the `main(argv)` dispatcher in-process.
 *
 * Avoids spawning child processes (slow + flaky in monorepo CI).
 * Captures stdout via console.log spy. Uses tmp DBs + memoryDir so
 * tests are isolated.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../src/cli.js';

let tmp: string;
let eventsDbPath: string;
let memoryDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mentor-cli-test-'));
  eventsDbPath = join(tmp, 'events.sqlite');
  memoryDir = join(tmp, 'memory');
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Clear env for deterministic tests
  delete process.env['CAIA_EVENT_BUS_DB_PATH'];
  delete process.env['CAIA_MEMORY_DIR'];
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});

function seedEventsDb(): void {
  const db = new Database(eventsDbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE events (
      id              TEXT PRIMARY KEY,
      event_type      TEXT NOT NULL,
      schema_version  INTEGER NOT NULL DEFAULT 1,
      correlation_id  TEXT,
      parent_event_id TEXT,
      emitted_at      TEXT NOT NULL,
      hostname        TEXT NOT NULL,
      process_name    TEXT,
      payload_json    TEXT NOT NULL,
      validation_failed INTEGER NOT NULL DEFAULT 0,
      ingest_offset   INTEGER NOT NULL UNIQUE
    );
    CREATE INDEX idx_events_type_off ON events(event_type, ingest_offset);
    INSERT INTO events VALUES (
      'ev_cli_test', 'OperatorCorrection', 1, NULL, NULL,
      '2026-05-05T01:00:00Z', 'test-host', 'test-proc',
      '{"correctionText":"stop asking","detectionMode":"manual"}',
      0, 1
    );
  `);
  db.close();
}

describe('cli main()', () => {
  it('process-once writes a proposal and prints {ok:true,processed:N}', async () => {
    seedEventsDb();
    await main(['process-once', '--db', eventsDbPath, '--memory', memoryDir]);
    const out = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('"processed":1');
    expect(out).toContain('"ok":true');
    const proposalsDir = join(memoryDir, 'proposals');
    const files = readdirSync(proposalsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toContain('decisionclassifierviolation');
  });

  it('process-once requires --memory or CAIA_MEMORY_DIR', async () => {
    seedEventsDb();
    await expect(
      main(['process-once', '--db', eventsDbPath])
    ).rejects.toThrow(/CAIA_MEMORY_DIR is required/);
  });

  it('process-once accepts CAIA_MEMORY_DIR env var as fallback', async () => {
    seedEventsDb();
    process.env['CAIA_MEMORY_DIR'] = memoryDir;
    await main(['process-once', '--db', eventsDbPath]);
    const proposalsDir = join(memoryDir, 'proposals');
    const files = readdirSync(proposalsDir);
    expect(files.length).toBe(1);
  });

  it('status prints offset + processed count', () => {
    seedEventsDb();
    main(['status', '--db', eventsDbPath]).catch(() => undefined);
    // status is sync; immediately check
    const out = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('"ok":true');
    expect(out).toContain('"lastOffset":0');
    expect(out).toContain('"processedCount":0');
  });

  it('--help prints usage and exits with code 2', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      await expect(main(['--help'])).rejects.toThrow(/exit 2/);
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('Usage'))).toBe(
        true
      );
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('unknown subcommand prints error + usage and exits with code 2', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      await expect(main(['bogus'])).rejects.toThrow(/exit 2/);
      expect(
        errSpy.mock.calls.some((c) => String(c[0]).includes('unknown subcommand'))
      ).toBe(true);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('flags can take values without spaces ahead of next flag', async () => {
    seedEventsDb();
    await main([
      'process-once',
      '--db',
      eventsDbPath,
      '--memory',
      memoryDir,
      '--batch',
      '50'
    ]);
    const out = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('"processed":1');
  });
});
