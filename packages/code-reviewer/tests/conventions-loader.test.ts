import { describe, it, expect } from 'vitest';
import { loadConventions, parseConventionsMarkdown } from '../src/conventions-loader.js';
import type { FsReader } from '../src/types.js';

const fakeFs = (files: Record<string, string>): FsReader => ({
  exists: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
  readFile: (p: string) => {
    if (!(p in files)) throw new Error(`ENOENT: ${p}`);
    return files[p];
  },
  readDir: () => []
});

describe('parseConventionsMarkdown', () => {
  it('extracts code-style sections', () => {
    const md = `# Title\n\n## Code style\nUse 2 spaces.\n\n## Random\nIgnored.`;
    const out = parseConventionsMarkdown('AGENTS.md', md);
    expect(out).toHaveLength(1);
    expect(out[0].heading.toLowerCase()).toContain('code style');
    expect(out[0].bodyExcerpt).toContain('2 spaces');
    expect(out[0].source).toBe('AGENTS.md');
  });

  it('extracts naming and testing sections', () => {
    const md = `## Naming\nCamelCase.\n\n## Testing\nVitest.`;
    const out = parseConventionsMarkdown('a.md', md);
    expect(out).toHaveLength(2);
    expect(out.some(s => s.heading.toLowerCase().includes('naming'))).toBe(true);
    expect(out.some(s => s.heading.toLowerCase().includes('testing'))).toBe(true);
  });

  it('extracts type-safety, correctness, bug-patterns', () => {
    const md = `## Type Safety\nNo \`any\`.\n\n## Correctness\nCheck nulls.\n\n## Bug Patterns\nWatch for off-by-one.`;
    const out = parseConventionsMarkdown('a.md', md);
    expect(out.length).toBe(3);
  });

  it('skips empty sections', () => {
    const md = `## Code style\n\n## Naming\nfoo`;
    const out = parseConventionsMarkdown('a.md', md);
    expect(out).toHaveLength(1);
    expect(out[0].heading.toLowerCase()).toContain('naming');
  });

  it('truncates long bodies', () => {
    const long = 'x'.repeat(2000);
    const md = `## Code style\n${long}`;
    const out = parseConventionsMarkdown('a.md', md);
    expect(out[0].bodyExcerpt.length).toBe(500);
  });
});

describe('loadConventions', () => {
  it('returns empty when file missing', () => {
    const fs = fakeFs({});
    expect(loadConventions(fs, '/nope.md')).toEqual([]);
  });

  it('returns parsed sections from a present file', () => {
    const fs = fakeFs({ '/AGENTS.md': '## Code style\nFoo bar baz' });
    const out = loadConventions(fs, '/AGENTS.md');
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('/AGENTS.md');
  });

  it('returns empty when readFile throws', () => {
    const fs: FsReader = {
      exists: () => true,
      readFile: () => { throw new Error('boom'); },
      readDir: () => []
    };
    expect(loadConventions(fs, '/x.md')).toEqual([]);
  });
});
