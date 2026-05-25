import { describe, expect, it } from 'vitest';

import { canonicalJson, diffBusinessPlans, hashBusinessPlan } from '../src/revisions.js';
import { samplePlan } from './fixtures/sample-plan.js';

describe('canonicalJson', () => {
  it('produces the same string regardless of key insertion order', () => {
    const a = { b: 2, a: 1, c: { y: 2, x: 1 } };
    const b = { a: 1, c: { x: 1, y: 2 }, b: 2 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles nested objects + primitives', () => {
    expect(canonicalJson({ s: 'x', n: 1, b: true, n2: null })).toBe(
      '{"b":true,"n":1,"n2":null,"s":"x"}',
    );
  });
});

describe('hashBusinessPlan', () => {
  it('is stable across key-order permutations', () => {
    const p1 = samplePlan(88);
    const p2 = { ...p1, sections: { ...(p1.sections as object), zzz: undefined } };
    delete (p2.sections as Record<string, unknown>).zzz;
    expect(hashBusinessPlan(p1)).toBe(hashBusinessPlan(p2));
  });

  it('changes when content changes', () => {
    const p1 = samplePlan(88);
    const p2 = samplePlan(89);
    expect(hashBusinessPlan(p1)).not.toBe(hashBusinessPlan(p2));
  });

  it('returns 64-char lowercase hex', () => {
    const h = hashBusinessPlan(samplePlan());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('diffBusinessPlans', () => {
  it('reports added, removed, and changed sections', () => {
    const a = { ...samplePlan(), sections: { x: 1, y: 2 } };
    const b = { ...samplePlan(), sections: { y: 99, z: 3 } };
    const d = diffBusinessPlans(a as never, b as never);
    expect(d.added_sections).toContain('z');
    expect(d.removed_sections).toContain('x');
    expect(d.changed_fields.map((c) => c.path)).toContain('sections.y');
    expect(d.field_count_delta).toBe('+1 added, -1 removed, ~1 changed');
  });

  it('empty diff when plans match', () => {
    const a = samplePlan();
    const d = diffBusinessPlans(a, a);
    expect(d.added_sections).toEqual([]);
    expect(d.removed_sections).toEqual([]);
    expect(d.changed_fields).toEqual([]);
  });
});
