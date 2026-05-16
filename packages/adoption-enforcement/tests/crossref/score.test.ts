import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyMaxCandidates,
  computeFrequencyWeight,
  computeScore,
  computeUniqueness,
  countExportingPackages,
  countTotalHits,
  DEFAULT_MAX_CANDIDATES,
  scoreCandidates,
} from '../../src/crossref/score.js';
import type { LiteralCandidate } from '../../src/crossref/literal-pattern.js';

// ---------------------------------------------------------------------------
// Test helpers — throwaway git repo on disk per test (parallels literal-pattern.test).
// ---------------------------------------------------------------------------

interface FixtureFile {
  path: string;
  content: string;
}

function mkRepo(files: ReadonlyArray<FixtureFile>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-score-test-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  for (const f of files) {
    const abs = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

function rmRepo(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function candidate(file: string, line = 1): LiteralCandidate {
  return {
    file,
    line,
    match: 'someLine',
    confidence: 'literal',
    reason: 'identifier match outside its own package',
  };
}

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

describe('computeUniqueness', () => {
  it('returns 1 for a single exporting package', () => {
    expect(computeUniqueness(1)).toBe(1);
  });
  it('returns 0.5 for two exporting packages', () => {
    expect(computeUniqueness(2)).toBe(0.5);
  });
  it('floors at 1 for zero (artefact source always counts at minimum)', () => {
    expect(computeUniqueness(0)).toBe(1);
  });
  it('floors at 1 for negative inputs', () => {
    expect(computeUniqueness(-3)).toBe(1);
  });
  it('floors fractional counts', () => {
    expect(computeUniqueness(3.9)).toBeCloseTo(1 / 3, 12);
  });
});

describe('computeFrequencyWeight', () => {
  it('returns 1 for zero hits (1 / log2(2))', () => {
    expect(computeFrequencyWeight(0)).toBe(1);
  });
  it('is strictly monotonically decreasing in hits', () => {
    expect(computeFrequencyWeight(2)).toBeGreaterThan(computeFrequencyWeight(10));
    expect(computeFrequencyWeight(10)).toBeGreaterThan(computeFrequencyWeight(100));
    expect(computeFrequencyWeight(100)).toBeGreaterThan(computeFrequencyWeight(1000));
  });
  it('matches the closed-form 1 / log2(2 + hits)', () => {
    expect(computeFrequencyWeight(6)).toBeCloseTo(1 / Math.log2(8), 12);
    expect(computeFrequencyWeight(14)).toBeCloseTo(1 / Math.log2(16), 12);
  });
  it('treats negative hits as zero', () => {
    expect(computeFrequencyWeight(-5)).toBe(1);
  });
});

describe('computeScore', () => {
  it('multiplies the two factors', () => {
    expect(computeScore(0.5, 0.25)).toBe(0.125);
  });
});

// ---------------------------------------------------------------------------
// Cap
// ---------------------------------------------------------------------------

describe('applyMaxCandidates', () => {
  it('keeps everything when under the cap', () => {
    const out = applyMaxCandidates([{ score: 1 }, { score: 2 }], 5);
    expect(out.kept.map((x) => x.score)).toEqual([2, 1]);
    expect(out.truncated).toBe(0);
  });
  it('keeps top N by score desc', () => {
    const out = applyMaxCandidates(
      [{ score: 1 }, { score: 5 }, { score: 3 }, { score: 4 }, { score: 2 }],
      3,
    );
    expect(out.kept.map((x) => x.score)).toEqual([5, 4, 3]);
    expect(out.truncated).toBe(2);
  });
  it('is stable for equal scores (preserves input order)', () => {
    const out = applyMaxCandidates(
      [
        { score: 1, tag: 'a' },
        { score: 1, tag: 'b' },
        { score: 1, tag: 'c' },
        { score: 1, tag: 'd' },
      ],
      2,
    );
    expect(out.kept.map((x) => x.tag)).toEqual(['a', 'b']);
    expect(out.truncated).toBe(2);
  });
  it('treats Infinity / 0 / negative as "no cap"', () => {
    const items = [{ score: 1 }, { score: 2 }];
    expect(applyMaxCandidates(items, Infinity).kept.length).toBe(2);
    expect(applyMaxCandidates(items, 0).kept.length).toBe(2);
    expect(applyMaxCandidates(items, -1).kept.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// scoreCandidates — composite using overrides (no repo I/O required)
// ---------------------------------------------------------------------------

describe('scoreCandidates (with overrides)', () => {
  it('attaches per-artefact score to every candidate', () => {
    const cands = [candidate('a.ts', 1), candidate('b.ts', 2), candidate('c.ts', 3)];
    const out = scoreCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'doSomethingRare' },
      cands,
      { repoRoot: '/nonexistent', exportingPackagesCount: 1, totalHits: 0 },
    );
    expect(out.scoring.uniqueness).toBe(1);
    expect(out.scoring.frequencyWeight).toBe(1);
    expect(out.scoring.score).toBe(1);
    expect(out.candidates.length).toBe(3);
    expect(out.candidates.every((c) => c.score === 1)).toBe(true);
  });

  it('applies default cap of 5', () => {
    const cands = Array.from({ length: 9 }, (_, i) => candidate(`f${i}.ts`, i + 1));
    const out = scoreCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'doSomethingRare' },
      cands,
      { repoRoot: '/nonexistent', exportingPackagesCount: 1, totalHits: 4 },
    );
    expect(out.candidates.length).toBe(DEFAULT_MAX_CANDIDATES);
    expect(out.truncated).toBe(9 - DEFAULT_MAX_CANDIDATES);
  });

  it('honours an explicit --max-candidates override', () => {
    const cands = Array.from({ length: 9 }, (_, i) => candidate(`f${i}.ts`, i + 1));
    const out = scoreCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'doSomethingRare' },
      cands,
      { repoRoot: '/nonexistent', maxCandidates: 2, exportingPackagesCount: 1, totalHits: 4 },
    );
    expect(out.candidates.length).toBe(2);
    expect(out.candidates.map((c) => c.file)).toEqual(['f0.ts', 'f1.ts']);
    expect(out.truncated).toBe(7);
  });

  it('disables cap when maxCandidates=Infinity', () => {
    const cands = Array.from({ length: 9 }, (_, i) => candidate(`f${i}.ts`, i + 1));
    const out = scoreCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'doSomethingRare' },
      cands,
      { repoRoot: '/nonexistent', maxCandidates: Infinity, exportingPackagesCount: 1, totalHits: 0 },
    );
    expect(out.candidates.length).toBe(9);
    expect(out.truncated).toBe(0);
  });

  it('rare-uniquely-exported identifier scores higher than common-multiply-exported one', () => {
    const rare = scoreCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'scanPii' },
      [candidate('x.ts')],
      { repoRoot: '/nonexistent', exportingPackagesCount: 1, totalHits: 3 },
    );
    const common = scoreCandidates(
      { kind: 'new_export', package: 'foo', identifier: 'Logger' },
      [candidate('x.ts')],
      { repoRoot: '/nonexistent', exportingPackagesCount: 4, totalHits: 150 },
    );
    expect(rare.scoring.score).toBeGreaterThan(common.scoring.score);
  });

  it('empty identifier yields zero-hit baseline and empty candidates pass through', () => {
    const out = scoreCandidates(
      { kind: 'new_export', package: 'foo', identifier: '   ' },
      [],
      { repoRoot: '/nonexistent' },
    );
    expect(out.scoring.exportingPackagesCount).toBe(0);
    expect(out.scoring.totalHits).toBe(0);
    expect(out.scoring.uniqueness).toBe(1);
    expect(out.scoring.frequencyWeight).toBe(1);
    expect(out.candidates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// countTotalHits + countExportingPackages — real git+fs against a fixture repo
// ---------------------------------------------------------------------------

describe('countTotalHits + countExportingPackages', () => {
  const created: string[] = [];
  afterEach(() => {
    while (created.length) {
      const d = created.pop();
      if (d) rmRepo(d);
    }
  });
  function repo(files: ReadonlyArray<FixtureFile>): string {
    const d = mkRepo(files);
    created.push(d);
    return d;
  }

  it('counts total raw hits across the repo (no filtering)', () => {
    const root = repo([
      { path: 'a.ts', content: 'scanPii(x); scanPii(y);\n' },
      { path: 'b.ts', content: 'scanPii(z);\n' },
      { path: 'c.ts', content: 'noMatch();\n' },
    ]);
    // 2 matches in a.ts (separate occurrences on one line → git grep -c counts the line once),
    // 1 in b.ts → expect 2.
    expect(countTotalHits('scanPii', root)).toBe(2);
  });

  it('returns 0 when nothing matches', () => {
    const root = repo([{ path: 'a.ts', content: 'nothing here\n' }]);
    expect(countTotalHits('scanPii', root)).toBe(0);
  });

  it('returns 0 for empty identifier', () => {
    const root = repo([{ path: 'a.ts', content: 'nothing\n' }]);
    expect(countTotalHits('', root)).toBe(0);
  });

  it('counts one @chiefaia/* package that exports the identifier', () => {
    const root = repo([
      {
        path: 'packages/guardrails-validator/package.json',
        content: JSON.stringify({ name: '@chiefaia/guardrails-validator', version: '0.0.0' }),
      },
      {
        path: 'packages/guardrails-validator/src/index.ts',
        content: 'export function scanPii(input: string) { return input; }\n',
      },
      // Consumer — not an exporter, must not be counted.
      {
        path: 'packages/worker-coding/package.json',
        content: JSON.stringify({ name: '@chiefaia/worker-coding', version: '0.0.0' }),
      },
      {
        path: 'packages/worker-coding/src/index.ts',
        content: "import { scanPii } from '@chiefaia/guardrails-validator';\nscanPii('x');\n",
      },
    ]);
    expect(countExportingPackages('scanPii', root)).toBe(1);
  });

  it('counts multiple @chiefaia/* packages on a name collision', () => {
    const root = repo([
      {
        path: 'packages/a/package.json',
        content: JSON.stringify({ name: '@chiefaia/a' }),
      },
      {
        path: 'packages/a/src/index.ts',
        content: 'export class Tracer {}\n',
      },
      {
        path: 'packages/b/package.json',
        content: JSON.stringify({ name: '@chiefaia/b' }),
      },
      {
        path: 'packages/b/src/index.ts',
        content: 'export class Tracer {}\n',
      },
      {
        path: 'packages/c/package.json',
        content: JSON.stringify({ name: '@chiefaia/c' }),
      },
      {
        path: 'packages/c/src/index.ts',
        content: 'export const unrelated = 1;\n',
      },
    ]);
    expect(countExportingPackages('Tracer', root)).toBe(2);
  });

  it('honours the export-list re-export syntax', () => {
    const root = repo([
      {
        path: 'packages/a/package.json',
        content: JSON.stringify({ name: '@chiefaia/a' }),
      },
      {
        path: 'packages/a/src/index.ts',
        content: "export { generateCaiaPrimer } from './primer.js';\n",
      },
      {
        path: 'packages/a/src/primer.ts',
        content: 'function generateCaiaPrimer() { return ""; }\n',
      },
    ]);
    expect(countExportingPackages('generateCaiaPrimer', root)).toBe(1);
  });

  it('ignores non-@chiefaia packages', () => {
    const root = repo([
      {
        path: 'packages/external-thing/package.json',
        content: JSON.stringify({ name: 'external-thing' }),
      },
      {
        path: 'packages/external-thing/src/index.ts',
        content: 'export function scanPii() {}\n',
      },
    ]);
    expect(countExportingPackages('scanPii', root)).toBe(0);
  });

  it('respects custom packageScope override', () => {
    const root = repo([
      {
        path: 'packages/foo/package.json',
        content: JSON.stringify({ name: '@acme/foo' }),
      },
      {
        path: 'packages/foo/src/index.ts',
        content: 'export const customThing = 1;\n',
      },
    ]);
    expect(countExportingPackages('customThing', root, '@chiefaia')).toBe(0);
    expect(countExportingPackages('customThing', root, '@acme')).toBe(1);
  });

  it('skips node_modules / dist / build when scanning sources', () => {
    const root = repo([
      {
        path: 'packages/foo/package.json',
        content: JSON.stringify({ name: '@chiefaia/foo' }),
      },
      {
        path: 'packages/foo/src/index.ts',
        content: 'export const realThing = 1;\n',
      },
      // The fake export sitting in dist/ MUST NOT inflate the count.
      {
        path: 'packages/foo/dist/index.js',
        content: 'export const ghostThing = 1;\n',
      },
      {
        path: 'packages/foo/node_modules/leftover/index.ts',
        content: 'export const ghostThing = 1;\n',
      },
    ]);
    expect(countExportingPackages('realThing', root)).toBe(1);
    expect(countExportingPackages('ghostThing', root)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreCandidates end-to-end against a real fixture repo
// ---------------------------------------------------------------------------

describe('scoreCandidates (real repo)', () => {
  const created: string[] = [];
  afterEach(() => {
    while (created.length) {
      const d = created.pop();
      if (d) rmRepo(d);
    }
  });
  function repo(files: ReadonlyArray<FixtureFile>): string {
    const d = mkRepo(files);
    created.push(d);
    return d;
  }

  it('computes uniqueness=1 and a finite frequency weight for a single-exporter identifier', () => {
    const root = repo([
      {
        path: 'packages/guardrails-validator/package.json',
        content: JSON.stringify({ name: '@chiefaia/guardrails-validator' }),
      },
      {
        path: 'packages/guardrails-validator/src/index.ts',
        content: 'export function scanPii(input: string) { return input; }\n',
      },
      {
        path: 'apps/worker-coding/src/safety/pii.ts',
        content: "import { scanPii } from '@chiefaia/guardrails-validator';\nscanPii('x');\n",
      },
    ]);
    const cands = [candidate('apps/worker-coding/src/safety/pii.ts', 2)];
    const out = scoreCandidates(
      { kind: 'new_export', package: '@chiefaia/guardrails-validator', identifier: 'scanPii' },
      cands,
      { repoRoot: root },
    );
    expect(out.scoring.exportingPackagesCount).toBe(1);
    expect(out.scoring.uniqueness).toBe(1);
    expect(out.scoring.totalHits).toBeGreaterThan(0);
    expect(out.scoring.frequencyWeight).toBeGreaterThan(0);
    expect(out.scoring.frequencyWeight).toBeLessThanOrEqual(1);
    expect(out.scoring.score).toBe(out.scoring.uniqueness * out.scoring.frequencyWeight);
  });
});
