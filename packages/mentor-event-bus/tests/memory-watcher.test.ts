/**
 * Tests for the MemoryWritten emit-point.
 *
 * We test:
 *   - filter rules (defaultFilter)
 *   - basic emit on file write (real fs.watch under tmp dir)
 *   - debounce collapses bursts
 *   - rejects non-existent rootDir
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startMemoryWatcher, defaultFilter } from '../src/memory-watcher';
import { Client } from '../src/client';
import { queryEvents } from '../src/sqlite';

const migrationsDir = join(__dirname, '..', 'migrations');

let tmpRoot: string;
let dbPath: string;
let client: Client;

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "mentor-memwatch-")));
  dbPath = join(tmpdir(), `mentor-memwatch-${Math.random().toString(36).slice(2)}.sqlite`);
  client = new Client({ dbPath, processName: 'memwatch-test', migrationsDir });
});

afterEach(() => {
  try {
    client.close();
  } catch {
    // already closed
  }
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(dbPath, { force: true });
});

describe('defaultFilter', () => {
  it('rejects dotfiles', () => {
    expect(defaultFilter('/dir/.hidden')).toBe(false);
    expect(defaultFilter('/dir/.DS_Store')).toBe(false);
  });

  it('rejects vim swap files', () => {
    expect(defaultFilter('/dir/foo.swp')).toBe(false);
  });

  it('rejects backup files (~ suffix)', () => {
    expect(defaultFilter('/dir/file~')).toBe(false);
  });

  it('accepts ordinary files', () => {
    expect(defaultFilter('/dir/foo.md')).toBe(true);
    expect(defaultFilter('/dir/feedback_x.md')).toBe(true);
  });
});

describe('startMemoryWatcher', () => {
  it('rejects when rootDir does not exist', () => {
    expect(() =>
      startMemoryWatcher({
        client,
        rootDir: '/no/such/dir/at/all',
        debounceMs: 1
      })
    ).toThrow(/does not exist/);
  });

  it('emits MemoryWritten when a file is created in the watch root', async () => {
    const watcher = startMemoryWatcher({
      client,
      rootDir: tmpRoot,
      debounceMs: 50,
      logger: { info: () => undefined, warn: () => undefined }
    });
    try {
      // Write a file
      const filePath = join(tmpRoot, 'feedback_test.md');
      writeFileSync(filePath, 'hello world', 'utf-8');

      // Wait for debounce + write to settle
      await sleep(800);

      const rows = queryEvents(client.unsafeGetDb(), { eventType: 'MemoryWritten' });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const payload = JSON.parse(rows[0]!.payload_json) as {
        path: string;
        size: number;
        operation: string;
      };
      expect(payload.path).toContain('feedback_test.md');
      expect(payload.size).toBe('hello world'.length);
    } finally {
      watcher.close();
    }
  });

  it('debounces rapid writes to the same path', async () => {
    const watcher = startMemoryWatcher({
      client,
      rootDir: tmpRoot,
      debounceMs: 100,
      logger: { info: () => undefined, warn: () => undefined }
    });
    try {
      const filePath = join(tmpRoot, 'rapid.md');
      // 5 rapid writes within debounce window
      for (let i = 0; i < 5; i++) {
        writeFileSync(filePath, `content-${i}`, 'utf-8');
        await sleep(10);
      }
      await sleep(800);

      const rows = queryEvents(client.unsafeGetDb(), { eventType: 'MemoryWritten' });
      const ours = rows.filter((r) => r.payload_json.includes('rapid.md'));
      // Should be at most 1-2 emits (debounced from 5)
      expect(ours.length).toBeLessThanOrEqual(2);
      expect(ours.length).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.close();
    }
  });

  it('skips dotfiles via defaultFilter', async () => {
    const watcher = startMemoryWatcher({
      client,
      rootDir: tmpRoot,
      debounceMs: 50,
      logger: { info: () => undefined, warn: () => undefined }
    });
    try {
      writeFileSync(join(tmpRoot, '.hidden'), 'x', 'utf-8');
      writeFileSync(join(tmpRoot, 'visible.md'), 'y', 'utf-8');
      await sleep(800);

      const rows = queryEvents(client.unsafeGetDb(), { eventType: 'MemoryWritten' });
      const dotfileRows = rows.filter((r) => r.payload_json.includes('.hidden'));
      const visibleRows = rows.filter((r) => r.payload_json.includes('visible.md'));
      expect(dotfileRows.length).toBe(0);
      expect(visibleRows.length).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.close();
    }
  });

  it('honours a custom filter', async () => {
    let filterCalls = 0;
    const filter = (p: string): boolean => {
      filterCalls++;
      return p.endsWith('.md');
    };
    const watcher = startMemoryWatcher({
      client,
      rootDir: tmpRoot,
      debounceMs: 50,
      filter,
      logger: { info: () => undefined, warn: () => undefined }
    });
    try {
      writeFileSync(join(tmpRoot, 'notes.md'), 'a', 'utf-8');
      writeFileSync(join(tmpRoot, 'config.json'), 'b', 'utf-8');
      await sleep(800);

      expect(filterCalls).toBeGreaterThan(0);
      const rows = queryEvents(client.unsafeGetDb(), { eventType: 'MemoryWritten' });
      const md = rows.filter((r) => r.payload_json.includes('notes.md'));
      const json = rows.filter((r) => r.payload_json.includes('config.json'));
      expect(md.length).toBeGreaterThanOrEqual(1);
      expect(json.length).toBe(0);
    } finally {
      watcher.close();
    }
  });

  it('close() clears pending debounced emits', async () => {
    const watcher = startMemoryWatcher({
      client,
      rootDir: tmpRoot,
      debounceMs: 5_000, // very long
      logger: { info: () => undefined, warn: () => undefined }
    });
    writeFileSync(join(tmpRoot, 'queued.md'), 'x', 'utf-8');
    await sleep(50);
    watcher.close();

    // After close, the pending timer is cleared and no emit should land.
    await sleep(200);
    const rows = queryEvents(client.unsafeGetDb(), { eventType: 'MemoryWritten' });
    const queued = rows.filter((r) => r.payload_json.includes('queued.md'));
    expect(queued.length).toBe(0);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
