import { describe, expect, it } from 'vitest';
import { scanCorpus, parseMemoryFile } from '../src/scanner.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';

describe('parseMemoryFile', () => {
  it('parses YAML frontmatter when well-formed', () => {
    const content = '---\nname: alpha\nsuperseded_by: beta\n---\nbody text';
    const f = parseMemoryFile('/root/alpha.md', '/root', content, 1000);
    expect(f.frontmatter).toEqual({ name: 'alpha', superseded_by: 'beta' });
    expect(f.body).toBe('body text');
    expect(f.supersededBy).toBe('beta');
  });

  it('returns null frontmatter when malformed yaml', () => {
    const content = '---\n!! broken yaml :::\n---\nbody';
    const f = parseMemoryFile('/root/x.md', '/root', content, 0);
    expect(f.frontmatter).toBeNull();
    expect(f.body).toBe('body');
  });

  it('returns null frontmatter when no fence', () => {
    const f = parseMemoryFile('/root/y.md', '/root', 'no fence body', 0);
    expect(f.frontmatter).toBeNull();
    expect(f.body).toBe('no fence body');
  });

  it('extracts wiki-links from body', () => {
    const f = parseMemoryFile('/root/z.md', '/root', 'See [[alpha]] and [[beta]]', 0);
    expect(f.wikiLinks).toEqual(['alpha', 'beta']);
  });

  it('extracts md-links to .md targets only', () => {
    const f = parseMemoryFile('/root/z.md', '/root', 'see [a](alpha.md) and [b](http://example.com) and [c](beta.md#frag)', 0);
    expect(f.mdLinks.map((m) => m.target)).toEqual(['alpha.md', 'beta.md']);
    expect(f.mdLinks.map((m) => m.text)).toEqual(['a', 'c']);
  });

  it('extracts supersededBy as null when missing', () => {
    const f = parseMemoryFile('/root/z.md', '/root', '---\nname: foo\n---\n', 0);
    expect(f.supersededBy).toBeNull();
  });

  it('supports camelCase supersededBy frontmatter key', () => {
    const f = parseMemoryFile('/root/z.md', '/root', '---\nsupersededBy: foo\n---\n', 0);
    expect(f.supersededBy).toBe('foo');
  });

  it('relPath is forward-slash relative', () => {
    const f = parseMemoryFile('/root/sub/x.md', '/root', '', 0);
    expect(f.relPath).toBe('sub/x.md');
  });
});

describe('scanCorpus', () => {
  it('walks subdirectories', () => {
    const fs = makeMemoryFsAdapter({
      '/m/a.md': '# A',
      '/m/sub/b.md': '# B',
      '/m/sub/deep/c.md': '# C',
    });
    const r = scanCorpus({ corpusRoot: '/m', fs });
    expect(r.files.map((f) => f.relPath).sort()).toEqual(['a.md', 'sub/b.md', 'sub/deep/c.md']);
  });

  it('skips dotfiles + dot-dirs + node_modules', () => {
    const fs = makeMemoryFsAdapter({
      '/m/a.md': '# A',
      '/m/.hidden.md': '# H',
      '/m/.git/config.md': '# G',
      '/m/node_modules/foo/x.md': '# X',
    });
    const r = scanCorpus({ corpusRoot: '/m', fs });
    expect(r.files.map((f) => f.relPath)).toEqual(['a.md']);
  });

  it('skips non-md files', () => {
    const fs = makeMemoryFsAdapter({
      '/m/a.md': '# A',
      '/m/b.txt': 'plain',
      '/m/c.json': '{}',
    });
    const r = scanCorpus({ corpusRoot: '/m', fs });
    expect(r.files.map((f) => f.relPath)).toEqual(['a.md']);
  });

  it('returns empty for nonexistent root', () => {
    const fs = makeMemoryFsAdapter({});
    const r = scanCorpus({ corpusRoot: '/nope', fs });
    expect(r.files).toEqual([]);
    expect(r.indexedRelPaths.size).toBe(0);
  });

  it('builds indexedRelPaths from MEMORY.md wiki-links + md-links', () => {
    const fs = makeMemoryFsAdapter({
      '/m/MEMORY.md': '# Index\n- [[alpha]]\n- [bee](beta.md)\n',
      '/m/alpha.md': '# A',
      '/m/beta.md': '# B',
      '/m/gamma.md': '# G',
    });
    const r = scanCorpus({ corpusRoot: '/m', fs });
    expect(r.indexedRelPaths.has('alpha.md')).toBe(true);
    expect(r.indexedRelPaths.has('beta.md')).toBe(true);
    expect(r.indexedRelPaths.has('gamma.md')).toBe(false);
  });

  it('honours custom indexFileName', () => {
    const fs = makeMemoryFsAdapter({
      '/m/INDEX.md': '- [[alpha]]\n',
      '/m/alpha.md': '# A',
    });
    const r = scanCorpus({ corpusRoot: '/m', indexFileName: 'INDEX.md', fs });
    expect(r.indexFileRelPath).toBe('INDEX.md');
    expect(r.indexedRelPaths.has('alpha.md')).toBe(true);
  });
});
