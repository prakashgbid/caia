import { describe, it, expect } from 'vitest';

import { generateConventionDoc } from '../src/convention-doc-generator.js';

describe('generateConventionDoc', () => {
  it('produces a non-trivial markdown body', () => {
    const out = generateConventionDoc({
      generatedAtIso: '2026-05-06T12:00:00.000Z',
      canonicalSuitePath: 'packages/apprentice-eval/suites/canonical-100.yaml'
    });
    expect(out).toContain('# AI/ML Architecture Conventions');
    expect(out).toContain('Model routing decision tree');
    expect(out).toContain('canonical-100.yaml');
  });

  it('is deterministic for fixed inputs', () => {
    const a = generateConventionDoc({
      generatedAtIso: '2026-05-06T12:00:00.000Z',
      canonicalSuitePath: 'X'
    });
    const b = generateConventionDoc({
      generatedAtIso: '2026-05-06T12:00:00.000Z',
      canonicalSuitePath: 'X'
    });
    expect(a).toBe(b);
  });

  it('changes with the canonicalSuitePath input', () => {
    const a = generateConventionDoc({
      generatedAtIso: '2026-05-06T12:00:00.000Z',
      canonicalSuitePath: 'A'
    });
    const b = generateConventionDoc({
      generatedAtIso: '2026-05-06T12:00:00.000Z',
      canonicalSuitePath: 'B'
    });
    expect(a).not.toBe(b);
  });
});
