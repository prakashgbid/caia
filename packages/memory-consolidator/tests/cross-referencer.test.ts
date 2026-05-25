import { describe, expect, it } from 'vitest';
import { findBrokenReferences } from '../src/cross-referencer.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import { scanCorpus } from '../src/scanner.js';

function scan(seed: Record<string, string>) {
  return scanCorpus({ corpusRoot: '/m', fs: makeMemoryFsAdapter(seed) });
}

describe('findBrokenReferences', () => {
  it('returns empty for an empty scan', () => {
    expect(findBrokenReferences({ files: [], indexedRelPaths: new Set(), indexFileRelPath: 'MEMORY.md' })).toEqual([]);
  });

  it('reports broken wiki-link', () => {
    const r = scan({ '/m/a.md': 'See [[bogus]]' });
    const findings = findBrokenReferences(r);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('broken-wikilink');
    expect(findings[0]?.detail).toContain('bogus');
  });

  it('resolves existing wiki-link target by basename', () => {
    const r = scan({ '/m/a.md': 'See [[beta]]', '/m/sub/beta.md': '# B' });
    expect(findBrokenReferences(r)).toEqual([]);
  });

  it('resolves wiki-link with explicit .md extension', () => {
    const r = scan({ '/m/a.md': 'See [[beta.md]]', '/m/beta.md': '# B' });
    expect(findBrokenReferences(r)).toEqual([]);
  });

  it('case-insensitive wiki match is on by default', () => {
    const r = scan({ '/m/a.md': 'See [[Beta]]', '/m/beta.md': '# B' });
    expect(findBrokenReferences(r)).toEqual([]);
  });

  it('case-insensitive wiki match can be disabled', () => {
    const r = scan({ '/m/a.md': 'See [[Beta]]', '/m/gamma.md': '# G' });
    const findings = findBrokenReferences(r, { caseInsensitiveWiki: false });
    expect(findings.some((f) => f.kind === 'broken-wikilink')).toBe(true);
  });

  it('reports broken md-link', () => {
    const r = scan({ '/m/a.md': 'see [b](b.md)' });
    const findings = findBrokenReferences(r);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('broken-mdlink');
  });

  it('resolves md-link relative to source dir', () => {
    const r = scan({ '/m/sub/a.md': 'see [b](b.md)', '/m/sub/b.md': '# B' });
    expect(findBrokenReferences(r)).toEqual([]);
  });

  it('resolves md-link as absolute-from-root', () => {
    const r = scan({ '/m/sub/a.md': 'see [b](beta.md)', '/m/beta.md': '# B' });
    expect(findBrokenReferences(r)).toEqual([]);
  });

  it('treats http(s) md-links as valid (out of scope)', () => {
    const r = scan({ '/m/a.md': 'see [g](https://example.com/foo.md)' });
    expect(findBrokenReferences(r)).toEqual([]);
  });

  it('strips fragments from md-link targets', () => {
    const r = scan({ '/m/a.md': 'see [b](b.md#section)', '/m/b.md': '# B' });
    expect(findBrokenReferences(r)).toEqual([]);
  });
});
