import { describe, it, expect } from 'vitest';

import { applyFilter } from '../src/filter.js';
import type { Finding } from '../src/types.js';

function fixture(over: Partial<Finding> = {}): Finding {
  return {
    id: over.id ?? 'a',
    source: 'memory',
    kind: 'memory-updated',
    key: 'k',
    title: 't',
    tsIso: over.tsIso ?? '2026-05-09T01:00:00.000Z',
    importance: over.importance ?? 0.5,
    tags: [],
    ...over
  };
}

describe('filter', () => {
  it('drops findings below floor', () => {
    const r = applyFilter([
      fixture({ id: 'low', importance: 0.1 }),
      fixture({ id: 'high', importance: 0.9 })
    ], { minImportance: 0.5, maxFindings: 100 });
    expect(r.kept.length).toBe(1);
    expect(r.kept[0]?.id).toBe('high');
    expect(r.dropped.length).toBe(1);
    expect(r.dropped[0]?.id).toBe('low');
  });

  it('caps result count and returns overflow as dropped', () => {
    const arr: Finding[] = [];
    for (let i = 0; i < 10; i++) {
      arr.push(fixture({ id: `i${i}`, importance: 0.5 + i * 0.01 }));
    }
    const r = applyFilter(arr, { minImportance: 0.0, maxFindings: 3 });
    expect(r.kept.length).toBe(3);
    expect(r.dropped.length).toBe(7);
  });

  it('orders kept by importance desc then ts desc then id asc', () => {
    const arr: Finding[] = [
      fixture({ id: 'b', importance: 0.5, tsIso: '2026-05-09T01:00:00.000Z' }),
      fixture({ id: 'a', importance: 0.5, tsIso: '2026-05-09T01:00:00.000Z' }),
      fixture({ id: 'c', importance: 0.9, tsIso: '2026-05-09T01:00:00.000Z' }),
      fixture({ id: 'd', importance: 0.5, tsIso: '2026-05-09T02:00:00.000Z' })
    ];
    const r = applyFilter(arr, { minImportance: 0.0, maxFindings: 100 });
    expect(r.kept.map(f => f.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('handles empty input', () => {
    const r = applyFilter([], { minImportance: 0.5, maxFindings: 10 });
    expect(r.kept.length).toBe(0);
    expect(r.dropped.length).toBe(0);
  });

  it('keeps everything when floor=0 and cap > size', () => {
    const arr = [fixture({ id: 'a' }), fixture({ id: 'b' })];
    const r = applyFilter(arr, { minImportance: 0, maxFindings: 100 });
    expect(r.kept.length).toBe(2);
    expect(r.dropped.length).toBe(0);
  });

  it('keeps overflow ordered correctly across floor + cap interaction', () => {
    const arr: Finding[] = [
      fixture({ id: 'low', importance: 0.1 }),
      fixture({ id: 'a', importance: 0.7 }),
      fixture({ id: 'b', importance: 0.8 }),
      fixture({ id: 'c', importance: 0.9 })
    ];
    const r = applyFilter(arr, { minImportance: 0.5, maxFindings: 2 });
    expect(r.kept.map(f => f.id)).toEqual(['c', 'b']);
    expect(r.dropped.map(f => f.id).sort()).toEqual(['a', 'low']);
  });

  it('does not mutate input array', () => {
    const arr: Finding[] = [
      fixture({ id: 'b', importance: 0.5 }),
      fixture({ id: 'a', importance: 0.9 })
    ];
    const before = arr.map(f => f.id);
    applyFilter(arr, { minImportance: 0, maxFindings: 100 });
    expect(arr.map(f => f.id)).toEqual(before);
  });

  it('floor at exactly equal value keeps the item', () => {
    const r = applyFilter([fixture({ id: 'x', importance: 0.5 })], {
      minImportance: 0.5,
      maxFindings: 10
    });
    expect(r.kept.length).toBe(1);
  });

  it('determinism: stable across two runs', () => {
    const arr: Finding[] = [
      fixture({ id: 'a', importance: 0.5 }),
      fixture({ id: 'b', importance: 0.5 }),
      fixture({ id: 'c', importance: 0.5 })
    ];
    const r1 = applyFilter(arr, { minImportance: 0, maxFindings: 100 });
    const r2 = applyFilter(arr, { minImportance: 0, maxFindings: 100 });
    expect(r1.kept.map(f => f.id)).toEqual(r2.kept.map(f => f.id));
  });

  it('cap=0 returns empty kept and full dropped', () => {
    const arr = [fixture({ id: 'a' })];
    const r = applyFilter(arr, { minImportance: 0, maxFindings: 0 });
    expect(r.kept.length).toBe(0);
    expect(r.dropped.length).toBe(1);
  });
});
