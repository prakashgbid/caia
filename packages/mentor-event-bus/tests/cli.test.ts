/**
 * CLI smoke tests — spawn the built CLI as a subprocess against a tmp DB.
 * These tests cover the cleanly-testable subcommands (record-correction,
 * count). The `tail` and `serve` subcommands run forever and are exercised
 * indirectly via the server.test.ts + http-client.test.ts integration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_DIST = resolve(__dirname, '..', 'dist', 'cli.js');

const skipIfNotBuilt = !existsSync(CLI_DIST);

let tmpDir: string;
let dbPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'caia-mentor-cli-'));
  dbPath = join(tmpDir, 'events.sqlite');
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('caia-mentor CLI', () => {
  it.skipIf(skipIfNotBuilt)('record-correction creates the DB and emits an event', () => {
    const result = spawnSync(
      process.execPath,
      [CLI_DIST, 'record-correction', 'use lowercase commit subjects', '--mode', 'manual'],
      {
        env: { ...process.env, CAIA_EVENT_BUS_DB_PATH: dbPath },
        encoding: 'utf-8'
      }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/"ok":true/);
    expect(result.stdout).toMatch(/"id":"ev_/);
    expect(existsSync(dbPath)).toBe(true);
  });

  it.skipIf(skipIfNotBuilt)('count returns 1 after one correction was recorded', () => {
    const result = spawnSync(process.execPath, [CLI_DIST, 'count'], {
      env: { ...process.env, CAIA_EVENT_BUS_DB_PATH: dbPath },
      encoding: 'utf-8'
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { count: number };
    expect(parsed.count).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(skipIfNotBuilt)('count --type filters by event type', () => {
    const result = spawnSync(
      process.execPath,
      [CLI_DIST, 'count', '--type', 'OperatorCorrection'],
      {
        env: { ...process.env, CAIA_EVENT_BUS_DB_PATH: dbPath },
        encoding: 'utf-8'
      }
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { count: number; eventType: string | null };
    expect(parsed.count).toBeGreaterThanOrEqual(1);
    expect(parsed.eventType).toBe('OperatorCorrection');
  });

  it.skipIf(skipIfNotBuilt)('count --type for non-existent type returns 0', () => {
    const result = spawnSync(
      process.execPath,
      [CLI_DIST, 'count', '--type', 'NonExistentEventType'],
      {
        env: { ...process.env, CAIA_EVENT_BUS_DB_PATH: dbPath },
        encoding: 'utf-8'
      }
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { count: number };
    expect(parsed.count).toBe(0);
  });

  it.skipIf(skipIfNotBuilt)('record-correction without a text arg fails with usage', () => {
    const result = spawnSync(process.execPath, [CLI_DIST, 'record-correction'], {
      env: { ...process.env, CAIA_EVENT_BUS_DB_PATH: dbPath },
      encoding: 'utf-8'
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage:/);
  });

  it.skipIf(skipIfNotBuilt)('unknown subcommand prints usage and exits 2', () => {
    const result = spawnSync(process.execPath, [CLI_DIST, 'frobnicate'], {
      env: { ...process.env, CAIA_EVENT_BUS_DB_PATH: dbPath },
      encoding: 'utf-8'
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/tail|record-correction|serve|count/);
  });

  it.skipIf(skipIfNotBuilt)('record-correction --mode regex sets detectionMode=regex', () => {
    const result = spawnSync(
      process.execPath,
      [CLI_DIST, 'record-correction', 'use unique migration prefixes', '--mode', 'regex'],
      {
        env: { ...process.env, CAIA_EVENT_BUS_DB_PATH: dbPath },
        encoding: 'utf-8'
      }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/"mode":"regex"/);
  });
});
