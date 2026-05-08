import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultFsReader } from '../src/fs-reader.js';

describe('defaultFsReader', () => {
  let dir: string;
  let filePath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cr-fs-reader-'));
    filePath = join(dir, 'hello.txt');
    writeFileSync(filePath, 'hello world');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'a.txt'), 'a');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exists returns true for existing file', () => {
    expect(defaultFsReader.exists(filePath)).toBe(true);
  });

  it('exists returns false for missing file', () => {
    expect(defaultFsReader.exists(join(dir, 'nope.txt'))).toBe(false);
  });

  it('readFile returns file content', () => {
    expect(defaultFsReader.readFile(filePath)).toBe('hello world');
  });

  it('readDir returns entries sorted', () => {
    const entries = defaultFsReader.readDir(dir);
    expect(entries.includes('hello.txt')).toBe(true);
    expect(entries.includes('sub')).toBe(true);
  });

  it('readDir returns [] for missing dir', () => {
    expect(defaultFsReader.readDir(join(dir, 'doesnotexist'))).toEqual([]);
  });

  it('readDir returns [] for a file (not a dir)', () => {
    expect(defaultFsReader.readDir(filePath)).toEqual([]);
  });
});
