/**
 * MemoryWritten emit-point.
 *
 * Watches a directory tree for file changes via Node's built-in
 * `fs.watch` (recursive=true; supported on macOS) and emits a
 * `MemoryWritten` event on every detected create / modify / delete.
 *
 * Phase-0 invariants:
 *   - never throws on emit failure (the underlying Client already swallows)
 *   - debounces bursts so a single editor save doesn't emit ten events
 *   - filters out hidden files and `.*.swp` style backup files
 *   - tolerates the watch root not existing yet (prints a warning + exits)
 *
 * Default watch path: $CAIA_MEMORY_DIR or ~/Documents/projects/caia/agent/memory.
 *
 * Used by:
 *   - the `caia-mentor watch-memory` CLI subcommand
 *   - the LaunchAgent plist `com.caia.mentor.memory-watcher.plist`
 */

import { watch, statSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import type { Client } from './client.js';
import type { MemoryWrittenPayload } from './types.js';

export interface WatchMemoryOptions {
  /** Mentor client used to emit. Caller manages lifecycle. */
  client: Client;
  /** Root directory to watch recursively. */
  rootDir: string;
  /** Debounce window in ms — events on the same path within the window collapse. Default 500. */
  debounceMs?: number;
  /** Filter — return false to skip emitting for a path. */
  filter?: (path: string) => boolean;
  /** Logger. Default: console. */
  logger?: { info: (m: string) => void; warn: (m: string, ctx?: unknown) => void };
  /** Test injection — overrides fs.watch. */
  watchFn?: typeof watch;
}

export interface MemoryWatcher {
  close(): void;
}

const DEFAULT_DEBOUNCE_MS = 500;

const consoleLogger = {
  info: (m: string): void => console.log(m),
  warn: (m: string, ctx?: unknown): void => {
    if (ctx !== undefined) console.warn(m, ctx);
    else console.warn(m);
  }
};

/**
 * Default filter: skip dotfiles + editor swap files + .DS_Store.
 */
export function defaultFilter(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  if (base.startsWith('.')) return false;
  if (base.endsWith('.swp') || base.endsWith('~')) return false;
  if (base === 'DS_Store') return false;
  return true;
}

/**
 * Start a memory-watcher daemon. Returns a handle with `close()`.
 *
 * Stops automatically when the watch root is removed (rare); also stops
 * when the caller invokes `close()`.
 */
export function startMemoryWatcher(opts: WatchMemoryOptions): MemoryWatcher {
  const { client, rootDir } = opts;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const filter = opts.filter ?? defaultFilter;
  const logger = opts.logger ?? consoleLogger;
  const watchFn = opts.watchFn ?? watch;

  if (!existsSync(rootDir)) {
    throw new Error(`startMemoryWatcher: rootDir does not exist: ${rootDir}`);
  }

  const pendingEmits = new Map<string, NodeJS.Timeout>();

  const watcher = watchFn(rootDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const fullPath = join(rootDir, String(filename));
    if (!filter(fullPath)) return;

    // Debounce per-path. The actual emit fires after `debounceMs` of quiet.
    const existing = pendingEmits.get(fullPath);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      pendingEmits.delete(fullPath);
      emitOne(client, rootDir, fullPath, eventType, logger);
    }, debounceMs);
    pendingEmits.set(fullPath, handle);
  });

  watcher.on('error', (err) => {
    logger.warn(`[memory-watcher] watcher error: ${err.message}`);
  });

  logger.info(`[memory-watcher] watching ${rootDir} (debounce=${debounceMs}ms)`);

  return {
    close: () => {
      for (const h of pendingEmits.values()) clearTimeout(h);
      pendingEmits.clear();
      watcher.close();
    }
  };
}

function emitOne(
  client: Client,
  rootDir: string,
  fullPath: string,
  eventType: string,
  logger: { warn: (m: string, ctx?: unknown) => void }
): void {
  const operation = classify(fullPath, eventType);
  let size = 0;
  let sha: string | undefined;
  try {
    if (existsSync(fullPath)) {
      size = statSync(fullPath).size;
      // Hash for small files only — caps ~1MB to avoid holding RAM.
      if (size <= 1024 * 1024) {
        const buf = readFileSync(fullPath);
        sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
      }
    }
  } catch (e) {
    logger.warn(`[memory-watcher] stat/read failed for ${fullPath}: ${e}`);
  }

  const payload: MemoryWrittenPayload = {
    path: relative(rootDir, fullPath) || fullPath,
    size,
    operation
  };
  if (sha !== undefined) payload.sha = sha;

  client.emit('MemoryWritten', payload);
}

function classify(fullPath: string, eventType: string): MemoryWrittenPayload['operation'] {
  if (!existsSync(fullPath)) return 'delete';
  if (eventType === 'rename') return 'create';
  return 'modify';
}
