import { describe, expect, it } from 'vitest';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';

describe('makeMemoryFsAdapter', () => {
  it('seeds files', () => {
    const fs = makeMemoryFsAdapter({ '/a/b.md': 'hi' });
    expect(fs.readFile('/a/b.md')).toBe('hi');
  });

  it('readDir returns immediate children only', () => {
    const fs = makeMemoryFsAdapter({
      '/m/a.md': '',
      '/m/sub/b.md': '',
      '/m/sub/deep/c.md': '',
    });
    expect(fs.readDir('/m')).toEqual(['a.md', 'sub']);
  });

  it('exists returns true for files and dirs', () => {
    const fs = makeMemoryFsAdapter({ '/m/sub/a.md': '' });
    expect(fs.exists('/m/sub/a.md')).toBe(true);
    expect(fs.exists('/m/sub')).toBe(true);
    expect(fs.exists('/m')).toBe(true);
    expect(fs.exists('/m/nope')).toBe(false);
  });

  it('writeFile + readFile round-trip', () => {
    const fs = makeMemoryFsAdapter({});
    fs.writeFile('/x/y.md', 'hello');
    expect(fs.readFile('/x/y.md')).toBe('hello');
  });

  it('appendFile appends', () => {
    const fs = makeMemoryFsAdapter({ '/x/y.md': 'a' });
    fs.appendFile('/x/y.md', 'b');
    expect(fs.readFile('/x/y.md')).toBe('ab');
  });

  it('appendFile creates if missing', () => {
    const fs = makeMemoryFsAdapter({});
    fs.appendFile('/x/y.md', 'a');
    expect(fs.readFile('/x/y.md')).toBe('a');
  });

  it('isDir returns false for leaf files', () => {
    const fs = makeMemoryFsAdapter({ '/x/y.md': '' });
    expect(fs.isDir('/x/y.md')).toBe(false);
  });

  it('readFile throws ENOENT for missing', () => {
    const fs = makeMemoryFsAdapter({});
    expect(() => fs.readFile('/missing')).toThrow();
  });
});
