import { describe, expect, it } from 'vitest';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';

describe('makeMemoryFsAdapter', () => {
  it('seeds files and reads them', () => {
    const fs = makeMemoryFsAdapter({ '/a.md': 'hi' });
    expect(fs.readFile('/a.md')).toBe('hi');
  });
  it('exists returns true for files', () => {
    const fs = makeMemoryFsAdapter({ '/a.md': '' });
    expect(fs.exists('/a.md')).toBe(true);
  });
  it('exists returns false for missing', () => {
    expect(makeMemoryFsAdapter({}).exists('/missing')).toBe(false);
  });
  it('writeFile + readFile round-trip', () => {
    const fs = makeMemoryFsAdapter({});
    fs.writeFile('/x.md', 'y');
    expect(fs.readFile('/x.md')).toBe('y');
  });
  it('appendFile creates if missing', () => {
    const fs = makeMemoryFsAdapter({});
    fs.appendFile('/x.md', 'y');
    expect(fs.readFile('/x.md')).toBe('y');
  });
  it('readDir returns immediate children', () => {
    const fs = makeMemoryFsAdapter({ '/d/a.md': '', '/d/sub/b.md': '' });
    expect(fs.readDir('/d')).toEqual(['a.md', 'sub']);
  });
});
