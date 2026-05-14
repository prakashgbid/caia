// H-13 (phase 9, 2026-05-14). Tests for src/backup.ts.
//
// Coverage:
//   - takeStateBackup writes a snapshot under <baseDir>/.backups/state.<iso>.<hr>.json
//   - the snapshot bytes match the source state.json
//   - LRU pruning keeps only `retention` newest files
//   - listBackups returns newest-first
//   - takeStateBackup is a noop when state.json is missing (default)
//   - takeStateBackup throws when state.json is missing AND skipIfMissing=false
//   - withStateBackup invokes the mutation closure and returns its value
//   - withStateBackupAsync awaits and returns the async result, snapshot taken first

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import { initState, loadContext, type StateContext } from '../src/state.js';
import {
  BACKUP_DIR_NAME,
  listBackups,
  pruneBackups,
  takeStateBackup,
  withStateBackup,
  withStateBackupAsync,
} from '../src/backup.js';
import { join } from 'node:path';

let fx: FixtureBundle;
let ctx: StateContext;

beforeEach(() => {
  fx = makeFixture(`backup-${Math.random().toString(36).slice(2, 8)}`);
  ctx = loadContext(fx.chainId, fx.specPath);
  initState(ctx);
});

afterEach(() => fx.cleanup());

describe('takeStateBackup', () => {
  it('writes a snapshot whose bytes match state.json', () => {
    const before = readFileSync(ctx.paths.stateFile, 'utf8');
    const r = takeStateBackup(ctx);
    expect(r.path).not.toBe('');
    expect(existsSync(r.path)).toBe(true);
    expect(readFileSync(r.path, 'utf8')).toBe(before);
    expect(r.path.startsWith(join(ctx.paths.baseDir, BACKUP_DIR_NAME))).toBe(true);
  });

  it('is a noop when state.json is missing (skipIfMissing default)', () => {
    // Move state.json out of the way
    const { unlinkSync } = require('node:fs') as typeof import('node:fs');
    unlinkSync(ctx.paths.stateFile);
    const r = takeStateBackup(ctx);
    expect(r.path).toBe('');
    expect(r.pruned).toEqual([]);
  });

  it('throws when skipIfMissing=false and state.json is missing', () => {
    const { unlinkSync } = require('node:fs') as typeof import('node:fs');
    unlinkSync(ctx.paths.stateFile);
    expect(() => takeStateBackup(ctx, { skipIfMissing: false })).toThrowError(
      /state\.json not found/,
    );
  });

  it('LRU prunes to retention count (newest kept)', () => {
    const created: string[] = [];
    for (let i = 0; i < 7; i++) {
      // mutate the state so each snapshot has distinct content (cheap proof
      // that we're keeping the newest)
      const raw = JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')) as Record<string, unknown>;
      raw['budget_consumed_pct'] = i;
      writeFileSync(ctx.paths.stateFile, JSON.stringify(raw));
      const r = takeStateBackup(ctx, { retention: 3 });
      created.push(r.path);
    }
    const remaining = listBackups(ctx);
    expect(remaining.length).toBe(3);
    // The 3 newest should be intact, the 4 oldest removed.
    for (const survivor of remaining) {
      expect(created).toContain(survivor);
    }
    const survivors = new Set(remaining);
    const expectedSurvivors = new Set(created.slice(-3));
    expect(survivors).toEqual(expectedSurvivors);
  });
});

describe('pruneBackups', () => {
  it('leaves non-matching files alone', () => {
    const { writeFileSync, mkdirSync, readdirSync } = require('node:fs') as typeof import('node:fs');
    const dir = join(ctx.paths.baseDir, BACKUP_DIR_NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json.bak.adjudicate-1.2026-05-14T00-00-00Z'), '{}');
    // 5 standard backups
    for (let i = 0; i < 5; i++) takeStateBackup(ctx);
    pruneBackups(ctx, 2);
    const remaining = readdirSync(dir);
    // The labeled sidecar must be untouched
    expect(remaining).toContain('state.json.bak.adjudicate-1.2026-05-14T00-00-00Z');
    // Plus 2 rolling backups
    const rollingCount = remaining.filter((n) => n.startsWith('state.') && n.endsWith('.json')).length;
    expect(rollingCount).toBe(2);
  });
});

describe('withStateBackup', () => {
  it('takes snapshot then runs mutation closure', () => {
    let mutationRan = false;
    const result = withStateBackup(ctx, () => {
      mutationRan = true;
      return 42;
    });
    expect(result).toBe(42);
    expect(mutationRan).toBe(true);
    expect(listBackups(ctx).length).toBe(1);
  });

  it('onBackup callback receives backup metadata', () => {
    let pathSeen = '';
    withStateBackup(
      ctx,
      () => undefined,
      {
        onBackup: (b) => {
          pathSeen = b.path;
        },
      },
    );
    expect(pathSeen).not.toBe('');
    expect(existsSync(pathSeen)).toBe(true);
  });
});

describe('withStateBackupAsync', () => {
  it('awaits mutation promise and returns resolved value', async () => {
    const result = await withStateBackupAsync(ctx, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'hello';
    });
    expect(result).toBe('hello');
    expect(listBackups(ctx).length).toBe(1);
  });

  it('snapshot is on disk even if mutation rejects', async () => {
    await expect(
      withStateBackupAsync(ctx, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(listBackups(ctx).length).toBe(1);
  });
});

describe('listBackups', () => {
  it('returns newest-first', async () => {
    const paths: string[] = [];
    for (let i = 0; i < 4; i++) {
      // Use a tiny sleep so mtimes are monotonic (mtimeMs ms-precision)
      await new Promise((r) => setTimeout(r, 4));
      const r = takeStateBackup(ctx);
      paths.push(r.path);
    }
    const sorted = listBackups(ctx);
    // newest-first means last-pushed first
    expect(sorted[0]).toBe(paths[paths.length - 1]);
    expect(sorted[sorted.length - 1]).toBe(paths[0]);
  });
});
