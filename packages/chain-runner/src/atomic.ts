import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, basename } from 'node:path';

function tempPathFor(targetPath: string): string {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  const unique = `${process.pid}-${process.hrtime.bigint().toString(36)}`;
  return `${dir}/.${base}.${unique}.tmp`;
}

/**
 * Atomic JSON write: write to a sibling temp file, fsync, rename.
 * The rename is atomic on POSIX, so readers see either the old or
 * the new file — never a half-written one. Survives mid-write crashes.
 */
export function atomicWriteJson<T>(path: string, data: T): void {
  const tmp = tempPathFor(path);
  const fd = openSync(tmp, 'w', 0o600);
  let closed = false;
  try {
    const json = `${JSON.stringify(data, sortKeysReplacer, 2)}\n`;
    writeSync(fd, json);
    fsyncSync(fd);
    closeSync(fd);
    closed = true;
    renameSync(tmp, path);
  } catch (err) {
    if (!closed) {
      try {
        closeSync(fd);
      } catch {
        // ignore double-close
      }
    }
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
    throw err;
  }
}

function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
