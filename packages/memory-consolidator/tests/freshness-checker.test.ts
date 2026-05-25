import { describe, expect, it } from 'vitest';
import { findFreshnessIssues } from '../src/freshness-checker.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import { scanCorpus } from '../src/scanner.js';

function scan(seed: Record<string, string>) {
  return scanCorpus({ corpusRoot: '/m', fs: makeMemoryFsAdapter(seed) });
}

describe('findFreshnessIssues — stale supersedes', () => {
  it('returns empty when nothing to check', () => {
    expect(findFreshnessIssues({ files: [], indexedRelPaths: new Set(), indexFileRelPath: 'MEMORY.md' })).toEqual([]);
  });

  it('reports stale supersedes when target file missing', () => {
    const r = scan({ '/m/a.md': '---\nsuperseded_by: ghost\n---\nbody' });
    const f = findFreshnessIssues(r);
    expect(f.some((x) => x.kind === 'stale-supersedes')).toBe(true);
  });

  it('does not report when supersede target exists', () => {
    const r = scan({
      '/m/MEMORY.md': '- [[a]]\n- [[b]]\n',
      '/m/a.md': '---\nsuperseded_by: b\n---\nbody',
      '/m/b.md': '# B',
    });
    const f = findFreshnessIssues(r);
    expect(f.some((x) => x.kind === 'stale-supersedes')).toBe(false);
  });

  it('matches supersede target by basename in subdir', () => {
    const r = scan({
      '/m/MEMORY.md': '- [[a]]\n- [[b]]\n',
      '/m/a.md': '---\nsuperseded_by: b.md\n---\nbody',
      '/m/sub/b.md': '# B',
    });
    expect(findFreshnessIssues(r).some((x) => x.kind === 'stale-supersedes')).toBe(false);
  });
});

describe('findFreshnessIssues — missing index entry', () => {
  it('reports missing-index-entry for referenced-but-unindexed file', () => {
    const r = scan({
      '/m/MEMORY.md': '- [[a]]\n',
      '/m/a.md': 'see [[b]]',
      '/m/b.md': '# B',
    });
    const f = findFreshnessIssues(r);
    expect(f.some((x) => x.kind === 'missing-index-entry' && x.sourceRelPath === 'b.md')).toBe(true);
  });

  it('does not flag a file that IS in the index', () => {
    const r = scan({
      '/m/MEMORY.md': '- [[a]]\n- [[b]]\n',
      '/m/a.md': 'see [[b]]',
      '/m/b.md': '# B',
    });
    expect(findFreshnessIssues(r).every((x) => x.kind !== 'missing-index-entry')).toBe(true);
  });

  it('never flags the index file itself', () => {
    const r = scan({
      '/m/MEMORY.md': '- [[a]]\n',
      '/m/a.md': 'see [MEMORY](MEMORY.md)',
    });
    expect(findFreshnessIssues(r).every((x) => x.sourceRelPath !== 'MEMORY.md')).toBe(true);
  });

  it('handles indexedRelPaths set by basename', () => {
    const r = scan({
      '/m/MEMORY.md': '- [[sub/b]]\n',
      '/m/a.md': 'see [b](sub/b.md)',
      '/m/sub/b.md': '# B',
    });
    const f = findFreshnessIssues(r);
    // b.md is referenced from a.md and reachable from index — should not flag.
    expect(f.every((x) => x.kind !== 'missing-index-entry' || x.sourceRelPath !== 'sub/b.md')).toBe(true);
  });
});
