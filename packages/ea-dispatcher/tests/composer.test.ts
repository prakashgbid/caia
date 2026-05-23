import { describe, it, expect } from 'vitest';
import {
  composeArchitectOutputs,
  composeArchitectOutputsLenient,
  CompositionError,
} from '../src/composer.js';
import type { ArchitectOutput } from '@caia/architect-kit';

function out(
  name: string,
  fields: Record<string, unknown>,
  status: ArchitectOutput['status'] = 'ok',
): ArchitectOutput {
  return {
    architectName: name,
    architectureFields: fields,
    confidence: 0.9,
    notes: '',
    dependencies: [],
    risks: [],
    toolCalls: [],
    spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'mock' },
    status,
  };
}

describe('composeArchitectOutputs — disjoint-key merge', () => {
  it('merges disjoint fields from multiple architects', () => {
    const r = composeArchitectOutputs([
      out('a', { 'a.x': 1 }),
      out('b', { 'b.x': 2 }),
    ]);
    expect(r.composed).toEqual({ 'a.x': 1, 'b.x': 2 });
  });

  it('returns empty for empty input', () => {
    expect(composeArchitectOutputs([]).composed).toEqual({});
  });

  it('skips outputs with status=failed', () => {
    const r = composeArchitectOutputs([
      out('a', { 'a.x': 1 }),
      out('bad', { 'bad.x': 'IGNORED' }, 'failed'),
    ]);
    expect(r.composed).toEqual({ 'a.x': 1 });
    expect(r.skippedFailed).toEqual(['bad']);
  });

  it('includes partial outputs in the composition', () => {
    const r = composeArchitectOutputs([
      out('a', { 'a.x': 1 }, 'partial'),
      out('b', { 'b.x': 2 }),
    ]);
    expect(r.composed).toEqual({ 'a.x': 1, 'b.x': 2 });
    expect(r.partialContributors).toEqual(['a']);
  });

  it('throws CompositionError when two architects claim the same path', () => {
    expect(() =>
      composeArchitectOutputs([
        out('a', { 'shared.x': 1 }),
        out('b', { 'shared.x': 2 }),
      ]),
    ).toThrow(CompositionError);
  });

  it('CompositionError carries the conflicting paths', () => {
    try {
      composeArchitectOutputs([
        out('a', { 'shared.x': 1 }),
        out('b', { 'shared.x': 2 }),
      ]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionError);
      const e = err as CompositionError;
      expect(e.collisions.map((c) => c.path)).toEqual(['shared.x']);
      expect(e.collisions[0]?.claimedBy).toEqual(['a', 'b']);
    }
  });

  it('lenient flavour records collisions instead of throwing', () => {
    const r = composeArchitectOutputsLenient([
      out('a', { 'shared.x': 1 }),
      out('b', { 'shared.x': 2 }),
    ]);
    expect(r.collisions).toEqual([{ path: 'shared.x', claimedBy: ['a', 'b'] }]);
    // last-write-wins under lenient
    expect(r.composed['shared.x']).toBe(2);
  });

  it('preserves the original value (no mutation across calls)', () => {
    const fields = { 'a.x': { nested: 1 } };
    const r = composeArchitectOutputs([out('a', fields)]);
    expect(r.composed).not.toBe(fields);
  });

  it('returns a fresh object on every call', () => {
    const r1 = composeArchitectOutputs([out('a', { x: 1 })]);
    const r2 = composeArchitectOutputs([out('a', { x: 1 })]);
    expect(r1.composed).not.toBe(r2.composed);
  });
});
