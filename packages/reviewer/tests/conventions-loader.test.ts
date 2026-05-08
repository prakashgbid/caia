import { describe, expect, it } from 'vitest';
import { loadConventions, parseConventionsMarkdown } from '../src/conventions-loader.js';
import type { FsReader } from '../src/types.js';

const fakeFs = (files: Record<string, string>): FsReader => ({
  exists: (p) => p in files,
  readFile: (p) => {
    const v = files[p];
    if (v === undefined) throw new Error(`missing ${p}`);
    return v;
  },
  readDir: () => []
});

describe('loadConventions', () => {
  it('returns [] when path missing', () => {
    const fs = fakeFs({});
    expect(loadConventions(fs, '/nope.md')).toEqual([]);
  });

  it('extracts craftsmanship-relevant headings', () => {
    const md = [
      '## Code style',
      '- TS strict',
      '- No any',
      '',
      '## Some other thing',
      '- nope',
      '',
      '## Naming',
      'identifiers self-describing',
      ''
    ].join('\n');
    const out = parseConventionsMarkdown('AGENTS.md', md);
    expect(out).toHaveLength(2);
    expect(out[0]?.heading).toBe('Code style');
    expect(out[1]?.heading).toBe('Naming');
    expect(out[0]?.bodyExcerpt).toContain('No any');
    expect(out[1]?.bodyExcerpt).toContain('self-describing');
  });

  it('caps body excerpt at 500 chars', () => {
    const md = '## Code style\n' + 'x'.repeat(600);
    const out = parseConventionsMarkdown('AGENTS.md', md);
    expect(out[0]?.bodyExcerpt.length).toBeLessThanOrEqual(500);
  });
});
