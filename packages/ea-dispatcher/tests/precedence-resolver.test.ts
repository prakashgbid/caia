import { describe, it, expect } from 'vitest';
import {
  annotateDissent,
  fieldBelongsTo,
  resolveConflicts,
  winnerOf,
} from '../src/precedence-resolver.js';
import type { FiredRule } from '../src/conflict-rules.js';
import type { SemanticConflictRule } from '../src/conflict-rules.js';

function mockRule(
  id: string,
  architects: [string, string],
  fields: readonly string[],
): SemanticConflictRule {
  return { id, description: id, architects, fields, detect: () => true };
}

function fired(rule: SemanticConflictRule): FiredRule {
  return { rule };
}

describe('resolveConflicts — precedence ladder', () => {
  it('annotates the lower-precedence architect with _dissent', () => {
    const composed: Record<string, unknown> = {
      'frontend.componentTree': [{ kind: 'iframe-embed' }],
      'security.cspPolicy': { frameSrc: "'none'" },
    };
    const records = resolveConflicts(
      [fired(mockRule('iframe', ['security', 'frontend'], ['security.cspPolicy', 'frontend.componentTree']))],
      composed,
    );
    expect(records.length).toBe(1);
    expect(records[0]?.winner).toBe('security');
    expect(records[0]?.loser).toBe('frontend');
    // Loser field gets _dissent
    const lost = composed['frontend.componentTree'];
    expect(lost).toHaveProperty('_dissent');
    // Winner stays untouched
    expect(composed['security.cspPolicy']).toEqual({ frameSrc: "'none'" });
  });

  it('orders security > frontend regardless of rule.architects order', () => {
    const c1: Record<string, unknown> = { 'security.x': 1, 'frontend.x': 2 };
    const c2: Record<string, unknown> = { 'security.x': 1, 'frontend.x': 2 };
    resolveConflicts([fired(mockRule('r', ['security', 'frontend'], ['security.x', 'frontend.x']))], c1);
    resolveConflicts([fired(mockRule('r', ['frontend', 'security'], ['security.x', 'frontend.x']))], c2);
    expect(c1['frontend.x']).toHaveProperty('_dissent');
    expect(c2['frontend.x']).toHaveProperty('_dissent');
  });

  it('orders a11y > seo > performance > frontend', () => {
    const composed: Record<string, unknown> = {
      'a11y.x': 'a',
      'seo.x': 's',
      'performance.x': 'p',
      'frontend.x': 'f',
    };
    resolveConflicts(
      [
        fired(mockRule('1', ['a11y', 'frontend'], ['a11y.x', 'frontend.x'])),
        fired(mockRule('2', ['seo', 'frontend'], ['seo.x', 'frontend.x'])),
        fired(mockRule('3', ['performance', 'frontend'], ['performance.x', 'frontend.x'])),
      ],
      composed,
    );
    expect(composed['a11y.x']).toBe('a'); // unmodified
    expect(composed['seo.x']).toBe('s');
    expect(composed['performance.x']).toBe('p');
    // frontend.x was annotated multiple times (the last write wins inside _dissent)
    expect(composed['frontend.x']).toHaveProperty('_dissent');
  });

  it('escalates same-architect conflicts', () => {
    const composed: Record<string, unknown> = { 'frontend.x': 1, 'frontend.y': 2 };
    const records = resolveConflicts(
      [fired(mockRule('intra', ['frontend', 'frontend'], ['frontend.x', 'frontend.y']))],
      composed,
    );
    expect(records[0]?.escalated).toBe(true);
  });

  it('escalates when both architects are unknown to the ladder', () => {
    const composed: Record<string, unknown> = { 'foo.x': 1, 'bar.x': 2 };
    const records = resolveConflicts(
      [fired(mockRule('r', ['foo', 'bar'], ['foo.x', 'bar.x']))],
      composed,
    );
    expect(records[0]?.escalated).toBe(true);
  });

  it('handles an empty fired list', () => {
    expect(resolveConflicts([], {})).toEqual([]);
  });
});

describe('fieldBelongsTo', () => {
  it('matches by direct prefix', () => {
    expect(fieldBelongsTo('frontend.componentTree', 'frontend')).toBe(true);
    expect(fieldBelongsTo('frontend.componentTree', 'backend')).toBe(false);
  });

  it('honors the featureFlagging→featureFlags alias', () => {
    expect(fieldBelongsTo('featureFlags.flagStore', 'featureFlagging')).toBe(true);
  });

  it('honors the accessibility→a11y alias', () => {
    expect(fieldBelongsTo('a11y.wcagLevel', 'accessibility')).toBe(true);
  });

  it('returns false for empty paths', () => {
    expect(fieldBelongsTo('', 'frontend')).toBe(false);
  });
});

describe('annotateDissent', () => {
  it('merges dissent into an existing object', () => {
    const c: Record<string, unknown> = { 'a.x': { foo: 1 } };
    annotateDissent(c, 'a.x', { conflictsWith: 'b', overriddenReason: 'r1' });
    expect(c['a.x']).toEqual({
      foo: 1,
      _dissent: { conflictsWith: 'b', overriddenReason: 'r1' },
    });
  });

  it('wraps a scalar value', () => {
    const c: Record<string, unknown> = { 'a.x': 42 };
    annotateDissent(c, 'a.x', { conflictsWith: 'b', overriddenReason: 'r' });
    expect(c['a.x']).toEqual({
      value: 42,
      _dissent: { conflictsWith: 'b', overriddenReason: 'r' },
    });
  });

  it('handles an absent field — records dissent on its own', () => {
    const c: Record<string, unknown> = {};
    annotateDissent(c, 'a.x', { conflictsWith: 'b', overriddenReason: 'r' });
    expect(c['a.x']).toEqual({
      _dissent: { conflictsWith: 'b', overriddenReason: 'r' },
    });
  });
});

describe('winnerOf', () => {
  it('returns the higher-precedence architect', () => {
    expect(winnerOf('security', 'frontend').winner).toBe('security');
  });

  it('returns null on tie', () => {
    expect(winnerOf('mystery-1', 'mystery-2').winner).toBe(null);
  });

  it('exposes the rank pair for diagnostics', () => {
    const { ranks } = winnerOf('security', 'frontend');
    expect(ranks[0]).toBe(1);
    expect(ranks[1]).toBe(14);
  });
});
