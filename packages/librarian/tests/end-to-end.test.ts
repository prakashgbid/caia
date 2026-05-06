/**
 * End-to-end smoke for the build → retrieve → prepend pipeline using a
 * fake embedder. Validates that the package's high-level surface
 * composes correctly without any network dependency.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndex } from '../src/index-builder.js';
import { prependPrecedent } from '../src/prepend.js';
import { retrievePrecedent } from '../src/retrieve.js';
import type { Embedder } from '../src/types.js';

function tokenSetVector(text: string, dim = 32): Float32Array {
  // Deterministic toy embedder: 32-dim hashed bag-of-words. Two prompts
  // sharing tokens get high cosine; disjoint prompts get low cosine.
  const v = new Float32Array(dim);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of tokens) {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    const idx = ((h % dim) + dim) % dim;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  // L2 normalize so cosine reduces to dot product
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += (v[i] ?? 0) * (v[i] ?? 0);
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / norm;
  }
  return v;
}

const tokenEmbedder: Embedder = async (text: string) => ({
  vector: tokenSetVector(text),
  model: 'token-set-fake'
});

describe('end-to-end: build → retrieve → prepend', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-e2e-test-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('surfaces the most relevant document for a token-overlapping query', async () => {
    const memoryDir = join(tmpRoot, 'memory');
    const reportsDir = join(tmpRoot, 'reports');
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });

    writeFileSync(
      join(memoryDir, 'mentor_agent_directive.md'),
      'Mentor agent captures incidents and distills lessons'
    );
    writeFileSync(
      join(memoryDir, 'curator_agent_directive.md'),
      'Curator agent scans the industry for opportunities'
    );
    writeFileSync(
      join(memoryDir, 'master_backlog_sequencing_2026-05-05.md'),
      'Master backlog sequencing schedules backlog items'
    );
    writeFileSync(
      join(reportsDir, 'enterprise-wave-1-leg-1-handoff.md'),
      'Enterprise wave 1 leg 1 ships claude subagents and promptfoo'
    );

    const buildStats = await buildIndex({
      memoryDir,
      reportsDir,
      embed: tokenEmbedder,
      log: () => undefined
    });
    expect(buildStats.scanned).toBe(4);
    expect(buildStats.embeddedNew).toBe(4);
    expect(Object.keys(buildStats.byKind).sort()).toEqual(
      ['directive', 'master', 'report'].sort()
    );

    // Retrieve: query about "mentor lessons" should top-1 the mentor directive.
    const top = await retrievePrecedent('mentor agent lessons captured', {
      memoryDir,
      embed: tokenEmbedder,
      minSimilarity: 0.1
    });
    expect(top.length).toBeGreaterThan(0);
    expect(top[0]?.slug).toBe('mentor_agent_directive');

    // Prepend: same query should produce an augmented prompt
    const prep = await prependPrecedent('mentor agent lessons captured', {
      memoryDir,
      embed: tokenEmbedder,
      minSimilarity: 0.1
    });
    expect(prep.augmented).toBe(true);
    expect(prep.augmentedPrompt).toMatch(/^Precedent from prior decisions/);
    expect(prep.augmentedPrompt).toContain('mentor agent lessons captured');
  });

  it('returns prompt unchanged when no document overlaps tokens', async () => {
    const memoryDir = join(tmpRoot, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, 'mentor_agent_directive.md'),
      'apple banana cherry'
    );

    const buildStats = await buildIndex({
      memoryDir,
      embed: tokenEmbedder,
      log: () => undefined
    });
    expect(buildStats.embeddedNew).toBe(1);

    const prep = await prependPrecedent('zebra walrus penguin', {
      memoryDir,
      embed: tokenEmbedder,
      minSimilarity: 0.4
    });
    expect(prep.augmented).toBe(false);
    expect(prep.augmentedPrompt).toBe('zebra walrus penguin');
  });

  it('honors kind filter end-to-end', async () => {
    const memoryDir = join(tmpRoot, 'memory');
    const reportsDir = join(tmpRoot, 'reports');
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'shared keyword tomato');
    writeFileSync(join(reportsDir, 'leg-1-handoff.md'), 'shared keyword tomato');

    await buildIndex({ memoryDir, reportsDir, embed: tokenEmbedder, log: () => undefined });

    const onlyDirectives = await retrievePrecedent('shared keyword', {
      memoryDir,
      embed: tokenEmbedder,
      minSimilarity: 0.1,
      kindFilter: 'directive'
    });
    expect(onlyDirectives.map((r) => r.kind)).toEqual(['directive']);

    const onlyReports = await retrievePrecedent('shared keyword', {
      memoryDir,
      embed: tokenEmbedder,
      minSimilarity: 0.1,
      kindFilter: 'report'
    });
    expect(onlyReports.map((r) => r.kind)).toEqual(['report']);
  });
});
