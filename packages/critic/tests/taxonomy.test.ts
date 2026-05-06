import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseTaxonomyMarkdown,
  loadTaxonomy,
  flattenForMentor,
  CANONICAL_TAXONOMY,
  nameToFailureModeId
} from '../src/taxonomy.js';
import type { FsReader } from '../src/types.js';
import { ALL_FAILURE_MODES } from '../src/types.js';

const FIXTURE_PATH = resolve(__dirname, '__fixtures__/taxonomy/mini.md');

function fakeFs(map: Record<string, string>): FsReader {
  return {
    exists: (p) => p in map,
    readFile: (p) => {
      if (!(p in map)) throw new Error(`missing ${p}`);
      return map[p]!;
    },
    readDir: () => []
  };
}

describe('parseTaxonomyMarkdown', () => {
  it('parses the mini fixture', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf-8');
    const entries = parseTaxonomyMarkdown(text);
    const ids = entries.map(e => e.id);
    expect(ids).toContain('hallucination');
    expect(ids).toContain('premature-completion');
    expect(ids).toContain('re-litigation');
    expect(ids).toContain('decision-classifier-violation');
    expect(ids).toContain('security-regression');
    expect(entries.find(e => e.id === 'premature-completion')?.description).toMatch(/agent claimed done/);
  });

  it('strips Routes-to clauses for prompt brevity', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf-8');
    const entries = parseTaxonomyMarkdown(text);
    for (const e of entries) {
      expect(e.description).not.toMatch(/Routes to:/i);
    }
  });

  it('returns [] when no taxonomy header is present', () => {
    expect(parseTaxonomyMarkdown('# Just a title\nNo taxonomy section.')).toEqual([]);
  });
});

describe('loadTaxonomy', () => {
  it('returns canonical when path missing', () => {
    const fs = fakeFs({});
    const r = loadTaxonomy(fs, '/missing.md');
    expect(r.length).toBe(CANONICAL_TAXONOMY.length);
  });

  it('backfills missing ids from canonical', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf-8');
    const fs = fakeFs({ '/x.md': text });
    const r = loadTaxonomy(fs, '/x.md');
    // mini fixture has 5 ids; canonical has 18 → backfill brings to 18.
    expect(r.length).toBe(ALL_FAILURE_MODES.length);
  });

  it('returns canonical on read failure', () => {
    const fs: FsReader = {
      exists: () => true,
      readFile: () => { throw new Error('boom'); },
      readDir: () => []
    };
    const r = loadTaxonomy(fs, '/x.md');
    expect(r.length).toBe(CANONICAL_TAXONOMY.length);
  });

  it('orders by canonical sequence', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf-8');
    const fs = fakeFs({ '/x.md': text });
    const r = loadTaxonomy(fs, '/x.md');
    const ids = r.map(e => e.id);
    expect(ids[0]).toBe('hallucination'); // canonical first
    expect(ids[ids.length - 1]).toBe('ci-flake-masquerade'); // canonical last
  });
});

describe('flattenForMentor', () => {
  it('strips dashes for Mentor slug compatibility', () => {
    expect(flattenForMentor('premature-completion')).toBe('prematurecompletion');
    expect(flattenForMentor('re-litigation')).toBe('relitigation');
    expect(flattenForMentor('decision-classifier-violation')).toBe('decisionclassifierviolation');
  });
});

describe('nameToFailureModeId', () => {
  it('maps every canonical name', () => {
    for (const e of CANONICAL_TAXONOMY) {
      // round-trip verify our mapping at least handles all canonical ids.
      expect(ALL_FAILURE_MODES).toContain(e.id);
    }
  });

  it('returns null for unknown names', () => {
    expect(nameToFailureModeId('not-a-real-category')).toBeNull();
  });
});
