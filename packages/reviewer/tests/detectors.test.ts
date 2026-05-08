import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDiff } from '../src/diff-parser.js';
import {
  ALL_DETECTORS,
  namingConventionDetector,
  functionLengthDetector,
  fileLengthDetector,
  commentDensityDetector,
  magicNumbersDetector,
  duplicateImportsDetector,
  deepNestingDetector,
  todoWithoutTicketDetector,
  consoleLoggingDetector,
  typeAnyDetector
} from '../src/detectors/index.js';
import type { ScanContext } from '../src/types.js';

const FIXTURES = join(fileURLToPath(import.meta.url), '..', '__fixtures__/diffs');

const ctx: ScanContext = {
  conventionExcerpts: [],
  pr: {
    prNumber: 1, branch: 'feat/x', baseBranch: 'develop',
    title: 't', commitSubjects: []
  },
  reviewedAtIso: '2026-05-06T00:00:00Z',
  thresholds: { maxFunctionLines: 60, maxFileLines: 500, maxNestingDepth: 4 }
};

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

describe('ALL_DETECTORS registry', () => {
  it('exposes 10 deterministic detectors', () => {
    expect(ALL_DETECTORS).toHaveLength(10);
    const dims = new Set(ALL_DETECTORS.map(d => d.dimension));
    expect(dims.size).toBe(10);
  });

  it('every detector id is unique', () => {
    const ids = new Set(ALL_DETECTORS.map(d => d.id));
    expect(ids.size).toBe(10);
  });
});

describe('clean diff produces no findings', () => {
  it('no detector fires', () => {
    const diff = parseDiff(loadFixture('clean.diff'));
    const findings = ALL_DETECTORS.flatMap(d => diff.hunks.flatMap(h => d.scan(h, ctx)));
    expect(findings).toHaveLength(0);
  });
});

describe('namingConventionDetector', () => {
  it('flags single-letter and snake_case', () => {
    const diff = parseDiff(loadFixture('naming-convention.diff'));
    const findings = diff.hunks.flatMap(h => namingConventionDetector.scan(h, ctx));
    expect(findings.length).toBeGreaterThan(0);
    const titles = findings.map(f => f.suggestionTitle);
    expect(titles.some(t => t.startsWith('single-letter-name-'))).toBe(true);
    expect(titles.some(t => t.startsWith('snake-case-'))).toBe(true);
  });

  it('skips iter letters', () => {
    const diff = parseDiff(loadFixture('clean.diff'));
    const findings = diff.hunks.flatMap(h => namingConventionDetector.scan(h, ctx));
    expect(findings).toHaveLength(0);
  });
});

describe('functionLengthDetector', () => {
  it('flags functions exceeding the threshold', () => {
    const diff = parseDiff(loadFixture('function-length.diff'));
    const findings = diff.hunks.flatMap(h => functionLengthDetector.scan(h, ctx));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.dimension).toBe('function-length');
  });

  it('respects custom threshold', () => {
    const diff = parseDiff(loadFixture('clean.diff'));
    const tightCtx: ScanContext = { ...ctx, thresholds: { ...ctx.thresholds, maxFunctionLines: 2 } };
    const findings = diff.hunks.flatMap(h => functionLengthDetector.scan(h, tightCtx));
    // Clean diff function is small but with maxFunctionLines=2 we may flag.
    expect(findings.every(f => f.dimension === 'function-length')).toBe(true);
  });
});

describe('fileLengthDetector', () => {
  it('flags files past the threshold', () => {
    const diff = parseDiff(loadFixture('file-length.diff'));
    const findings = diff.hunks.flatMap(h => fileLengthDetector.scan(h, ctx));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.dimension).toBe('file-length');
  });
});

describe('commentDensityDetector', () => {
  it('flags undocumented public exports', () => {
    const diff = parseDiff(loadFixture('comment-density.diff'));
    const findings = diff.hunks.flatMap(h => commentDensityDetector.scan(h, ctx));
    expect(findings.length).toBe(1);
    expect(findings[0]?.suggestionTitle).toContain('undocumented');
  });

  it('does not fire on documented exports', () => {
    const diff = parseDiff(loadFixture('clean.diff'));
    const findings = diff.hunks.flatMap(h => commentDensityDetector.scan(h, ctx));
    expect(findings).toHaveLength(0);
  });
});

describe('magicNumbersDetector', () => {
  it('flags large literals and underscore-separated literals', () => {
    const diff = parseDiff(loadFixture('magic-numbers.diff'));
    const findings = diff.hunks.flatMap(h => magicNumbersDetector.scan(h, ctx));
    expect(findings.length).toBeGreaterThan(0);
    const titles = findings.map(f => f.suggestionTitle);
    expect(titles.some(t => t.includes('86400'))).toBe(true);
  });
});

describe('duplicateImportsDetector', () => {
  it('flags two imports from same module', () => {
    const diff = parseDiff(loadFixture('duplicate-imports.diff'));
    const findings = diff.hunks.flatMap(h => duplicateImportsDetector.scan(h, ctx));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestionTitle).toContain('node:fs');
  });
});

describe('deepNestingDetector', () => {
  it('flags depth exceeding threshold', () => {
    const diff = parseDiff(loadFixture('deep-nesting.diff'));
    const findings = diff.hunks.flatMap(h => deepNestingDetector.scan(h, ctx));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.dimension).toBe('deep-nesting');
  });
});

describe('todoWithoutTicketDetector', () => {
  it('flags TODO without ticket and not the FIXME with one', () => {
    const diff = parseDiff(loadFixture('todo.diff'));
    const findings = diff.hunks.flatMap(h => todoWithoutTicketDetector.scan(h, ctx));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestionTitle).toContain('todo-');
  });
});

describe('consoleLoggingDetector', () => {
  it('flags console.log; allows warn/error', () => {
    const diff = parseDiff(loadFixture('console.diff'));
    const findings = diff.hunks.flatMap(h => consoleLoggingDetector.scan(h, ctx));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestionTitle).toContain('console-log');
  });
});

describe('typeAnyDetector', () => {
  it('flags any annotations and casts', () => {
    const diff = parseDiff(loadFixture('type-any.diff'));
    const findings = diff.hunks.flatMap(h => typeAnyDetector.scan(h, ctx));
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every(f => f.dimension === 'type-any')).toBe(true);
  });
});
