/**
 * Tests for context-dump loader + validator + thickness scoring.
 */

import { describe, expect, it } from 'vitest';

import {
  computeThickness,
  loadContextDump,
  makeStubContextDump,
  normaliseContextDump,
  validateContextDump,
  dumpPathForPlan
} from '../src/context-dump.js';
import { MemoryFs } from '../src/fs.js';

describe('dumpPathForPlan', () => {
  it('derives the .context-dumps sibling path', () => {
    const p = dumpPathForPlan('/Users/x/Documents/projects/research/my-plan.md');
    expect(p).toBe('/Users/x/Documents/projects/research/.context-dumps/my-plan.json');
  });
});

describe('normaliseContextDump', () => {
  it('coerces missing fields to safe defaults', () => {
    const dump = normaliseContextDump({});
    expect(dump.schema_version).toBe(1);
    expect(dump.decision_points).toEqual([]);
    expect(dump.sources_consulted).toEqual([]);
  });

  it('parses a well-formed dump', () => {
    const dump = makeStubContextDump();
    const parsed = normaliseContextDump(JSON.parse(JSON.stringify(dump)));
    expect(parsed.plan_slug).toBe(dump.plan_slug);
    expect(parsed.decision_points.length).toBe(1);
  });
});

describe('validateContextDump', () => {
  it('rejects an empty dump', () => {
    const result = validateContextDump(normaliseContextDump({}));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('missing-required-field');
    expect(result.errors).toContain('no-decision-points');
  });

  it('accepts a thick stub dump', () => {
    const dump = makeStubContextDump({
      reasoning_summary: 'word '.repeat(600).trim(),
      sources_consulted: Array.from({ length: 5 }, () => ({
        type: 'caia-file' as const,
        citation: 'x',
        relevance: 'y'
      })),
      decision_points: Array.from({ length: 3 }, (_, i) => ({
        decision: `d${i}`,
        options_considered: ['a', 'b'],
        chosen: 'a',
        rationale: 'r',
        confidence: 'high' as const,
        revisitable_if: 'never'
      }))
    });
    const result = validateContextDump(dump);
    expect(result.ok).toBe(true);
    expect(result.thickness).toBeGreaterThan(0.45);
  });
});

describe('loadContextDump', () => {
  it('throws on missing file', () => {
    const fs = new MemoryFs();
    expect(() => loadContextDump('/tmp/missing.json', fs)).toThrow(/not found/);
  });

  it('throws on invalid JSON', () => {
    const fs = new MemoryFs({ '/tmp/bad.json': 'not json' });
    expect(() => loadContextDump('/tmp/bad.json', fs)).toThrow(/not valid JSON/);
  });

  it('loads a well-formed dump', () => {
    const dump = makeStubContextDump();
    const fs = new MemoryFs({ '/tmp/good.json': JSON.stringify(dump) });
    const loaded = loadContextDump('/tmp/good.json', fs);
    expect(loaded.plan_slug).toBe(dump.plan_slug);
  });
});

describe('computeThickness', () => {
  it('returns 0..1', () => {
    const dump = makeStubContextDump();
    const t = computeThickness(dump);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(1);
  });

  it('thicker dumps score higher', () => {
    const thin = makeStubContextDump({ reasoning_summary: 'a b c' });
    const thick = makeStubContextDump({
      reasoning_summary: 'word '.repeat(1200).trim(),
      decision_points: Array.from({ length: 5 }, (_, i) => ({
        decision: `d${i}`,
        options_considered: ['a', 'b', 'c'],
        chosen: 'a',
        rationale: 'r',
        confidence: 'high' as const,
        revisitable_if: 'x'
      })),
      sources_consulted: Array.from({ length: 8 }, () => ({
        type: 'caia-file' as const,
        citation: 'x',
        relevance: 'y'
      }))
    });
    expect(computeThickness(thick)).toBeGreaterThan(computeThickness(thin));
  });
});
