import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_TOKEN_BUDGET } from '../src/defaults.js';
import { generateCaiaPrimer } from '../src/generate.js';
import type { FsReader } from '../src/types.js';

const FIXTURES = join(__dirname, '..', 'fixtures');

/**
 * In-memory FsReader backed by a path → content map. Production injects
 * the real defaultFsReader; tests inject this. This is the live proof
 * that Option E gate 3 (fixture-corpus tests) works for this package.
 */
function fakeFsReader(map: Record<string, string>): FsReader {
  return {
    readFile(p: string): string {
      const content = map[p];
      if (content === undefined) throw new Error(`fake fs: ${p} not in map`);
      return content;
    },
    exists(p: string): boolean {
      return Object.hasOwn(map, p);
    }
  };
}

const memoryMd = readFileSync(join(FIXTURES, 'memory-index.md'), 'utf-8');
const archMd = readFileSync(join(FIXTURES, 'architecture.md'), 'utf-8');
const seqMd = readFileSync(join(FIXTURES, 'sequencing.md'), 'utf-8');

const fixtureFs = fakeFsReader({
  '/fake/memory.md': memoryMd,
  '/fake/arch.md': archMd,
  '/fake/seq.md': seqMd
});

describe('generateCaiaPrimer (fixture corpus)', () => {
  it('produces a primer from injected fixture paths (Option E gate 3)', () => {
    const result = generateCaiaPrimer({
      memoryIndexPath: '/fake/memory.md',
      architectureDocPath: '/fake/arch.md',
      dodSourcePath: '/fake/seq.md',
      fsReader: fixtureFs
    });
    expect(result.text).toContain('CAIA Primer');
    expect(result.text).toContain('Standing Instructions');
    expect(result.text).toContain('Architecture');
    expect(result.text).toContain('Definition of Done');
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.trimmed).toBe(false);
  });

  it('is deterministic — same fixtures yield byte-identical output', () => {
    const a = generateCaiaPrimer({
      memoryIndexPath: '/fake/memory.md',
      architectureDocPath: '/fake/arch.md',
      dodSourcePath: '/fake/seq.md',
      fsReader: fixtureFs
    });
    const b = generateCaiaPrimer({
      memoryIndexPath: '/fake/memory.md',
      architectureDocPath: '/fake/arch.md',
      dodSourcePath: '/fake/seq.md',
      fsReader: fixtureFs
    });
    expect(a.text).toBe(b.text);
    expect(a.estimatedTokens).toBe(b.estimatedTokens);
  });

  it('respects the default 1000-token budget on the fixture corpus', () => {
    const result = generateCaiaPrimer({
      memoryIndexPath: '/fake/memory.md',
      architectureDocPath: '/fake/arch.md',
      dodSourcePath: '/fake/seq.md',
      fsReader: fixtureFs
    });
    expect(result.estimatedTokens).toBeLessThanOrEqual(DEFAULT_TOKEN_BUDGET);
  });

  it('throws when a source file is missing', () => {
    const partialFs = fakeFsReader({
      '/fake/memory.md': memoryMd
      // arch + seq absent
    });
    expect(() =>
      generateCaiaPrimer({
        memoryIndexPath: '/fake/memory.md',
        architectureDocPath: '/fake/arch.md',
        dodSourcePath: '/fake/seq.md',
        fsReader: partialFs
      })
    ).toThrow(/required source file not found/);
  });

  it('throws on overflow when summariseOnOverflow is false', () => {
    expect(() =>
      generateCaiaPrimer({
        memoryIndexPath: '/fake/memory.md',
        architectureDocPath: '/fake/arch.md',
        dodSourcePath: '/fake/seq.md',
        fsReader: fixtureFs,
        tokenBudget: 1, // impossibly small
        summariseOnOverflow: false
      })
    ).toThrow(/over budget/);
  });

  it('reports trimmed=true when forced under a tight budget', () => {
    // Memory fixture with bullets large enough to overflow the un-trimmed
    // primer but small enough that first-sentence trimming still fits.
    // Each bullet has a first sentence ~50 chars (compactable) + a much
    // longer continuation that the trimmer drops.
    const bigMemory = [
      '## Standing Instructions',
      ...Array.from({ length: 10 }, (_, i) =>
        `- Rule ${i}: short first sentence here. ` +
          'This is a much longer continuation that the trimmer should drop ' +
          'when the first-sentence-only stage runs to fit the budget.'
      ),
      '## Other'
    ].join('\n');
    const fs = fakeFsReader({
      '/m.md': bigMemory,
      '/a.md': archMd,
      '/s.md': seqMd
    });
    const result = generateCaiaPrimer({
      memoryIndexPath: '/m.md',
      architectureDocPath: '/a.md',
      dodSourcePath: '/s.md',
      fsReader: fs,
      tokenBudget: 350,
      summariseOnOverflow: true
    });
    expect(result.estimatedTokens).toBeLessThanOrEqual(350);
    expect(result.trimmed).toBe(true);
  });

  it('alphabetises standing-instructions deterministically', () => {
    const reordered = [
      '## Standing Instructions',
      '- Z rule',
      '- A rule',
      '- M rule',
      '## End'
    ].join('\n');
    const fs = fakeFsReader({
      '/m.md': reordered,
      '/a.md': archMd,
      '/s.md': seqMd
    });
    const result = generateCaiaPrimer({
      memoryIndexPath: '/m.md',
      architectureDocPath: '/a.md',
      dodSourcePath: '/s.md',
      fsReader: fs
    });
    const aIdx = result.text.indexOf('A rule');
    const mIdx = result.text.indexOf('M rule');
    const zIdx = result.text.indexOf('Z rule');
    expect(aIdx).toBeGreaterThan(-1);
    expect(mIdx).toBeGreaterThan(aIdx);
    expect(zIdx).toBeGreaterThan(mIdx);
  });
});

describe('generateCaiaPrimer — snapshot', () => {
  it('matches the fixture-corpus golden output', () => {
    const result = generateCaiaPrimer({
      memoryIndexPath: '/fake/memory.md',
      architectureDocPath: '/fake/arch.md',
      dodSourcePath: '/fake/seq.md',
      fsReader: fixtureFs
    });
    expect(result.text).toMatchInlineSnapshot(`
      "# CAIA Primer

      You are operating inside the CAIA monorepo (multi-agent AI software
      development platform). This primer is auto-generated from the standing
      rules. Read it before reasoning. Detailed runbooks live in agent/memory/
      and docs/ — pull what you need on demand.

      ## Standing Instructions (inviolate)

      - 🚨 Fixture rule A — applies always. Filed for testing.
      - 🚨 Fixture rule C — must come before D in alphabetical order to test the sort.
      - Fixture rule B — secondary rule, no urgency.
      - Fixture rule D — last alphabetically.

      ## Architecture (caia_architecture.md ToC)

      - Overview
      - Hono Microservices
      - Event Bus
      - Observability
      - ADRs

      ## Definition of Done (10-stage)

      1. Analyze
      2. Research
      3. Solution
      4. Implement
      5. Unit test
      6. Integration test
      7. Deploy
      8. E2E live verify
      9. Regression test
      10. Document+learn
      "
    `);
  });
});
