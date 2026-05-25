import { describe, expect, it } from 'vitest';

import {
  allocateByKindMix,
  DEFAULT_KIND_MIX,
  deriveDate,
  deriveId,
  mergeKindMix,
  normaliseHit,
  sumMix,
} from '../src/embedder.js';

import { canonicalHits, hit, row } from './fixtures.js';

describe('mergeKindMix', () => {
  it('returns defaults when no input is supplied', () => {
    expect(mergeKindMix()).toEqual({
      adr: 3,
      principle: 1,
      lesson: 1,
      feedback: 1,
      other: 0,
    });
  });

  it('preserves caller overrides and fills the rest from defaults', () => {
    const m = mergeKindMix({ adr: 5, other: 2 });
    expect(m.adr).toBe(5);
    expect(m.other).toBe(2);
    expect(m.principle).toBe(DEFAULT_KIND_MIX.principle);
    expect(m.feedback).toBe(DEFAULT_KIND_MIX.feedback);
  });

  it('honours explicit zeros (a caller can disable a kind)', () => {
    const m = mergeKindMix({ feedback: 0 });
    expect(m.feedback).toBe(0);
    expect(m.adr).toBe(DEFAULT_KIND_MIX.adr);
  });
});

describe('sumMix', () => {
  it('sums all five slots', () => {
    expect(sumMix({ adr: 1, principle: 2, lesson: 3, feedback: 4, other: 5 }))
      .toBe(15);
  });

  it('returns 6 for DEFAULT_KIND_MIX', () => {
    expect(sumMix(DEFAULT_KIND_MIX)).toBe(6);
  });
});

describe('normaliseHit', () => {
  it('classifies pure ADR rows as adr', () => {
    const a = normaliseHit(hit(row({ name: 'ADR-099 Something', kind: 'adr' })));
    expect(a.kind).toBe('adr');
    expect(a.id).toBe('ADR-099');
  });

  it('classifies kind=adr + tag=principle as principle', () => {
    const a = normaliseHit(
      hit(row({ name: 'P9 Cost discipline', kind: 'adr', tags: ['principle'] })),
    );
    expect(a.kind).toBe('principle');
    expect(a.id).toBe('P9');
  });

  it('classifies kind=adr + tag=lesson as lesson', () => {
    const a = normaliseHit(
      hit(row({ name: 'L02 Some lesson', kind: 'adr', tags: ['lesson'] })),
    );
    expect(a.kind).toBe('lesson');
  });

  it('classifies kind=adr + tag=feedback as feedback', () => {
    const a = normaliseHit(
      hit(row({ name: 'feedback-foo', kind: 'adr', tags: ['feedback'] })),
    );
    expect(a.kind).toBe('feedback');
    expect(a.id).toBe('feedback-foo');
  });

  it('falls through to other for unrecognised kinds with no tag', () => {
    const a = normaliseHit(hit(row({ name: 'SomeComponent', kind: 'component' })));
    expect(a.kind).toBe('other');
  });

  it('preserves the fused score', () => {
    const a = normaliseHit(hit(row({}), 0.71));
    expect(a.score).toBe(0.71);
  });

  it('keeps the raw hit on .raw', () => {
    const h = hit(row({}));
    const a = normaliseHit(h);
    expect(a.raw).toBe(h);
  });
});

describe('deriveId', () => {
  it('extracts an ADR-NNN prefix from the name', () => {
    expect(deriveId(hit(row({ name: 'ADR-011 Event-first state' })))).toBe('ADR-011');
  });

  it('extracts a P-NN prefix from the name', () => {
    expect(deriveId(hit(row({ name: 'P14 Subscription only' })))).toBe('P14');
  });

  it('extracts an L-NN prefix from the name', () => {
    expect(deriveId(hit(row({ name: 'L03 Some lesson title' })))).toBe('L03');
  });

  it('extracts a feedback-* slug from the name', () => {
    expect(deriveId(hit(row({ name: 'feedback-no-timelines' })))).toBe(
      'feedback-no-timelines',
    );
  });

  it('falls back to entryPath basename without extension', () => {
    expect(
      deriveId(hit(row({ name: 'no-id-prefix', entryPath: 'caia-ea/decisions/foo.md' }))),
    ).toBe('foo');
  });

  it('falls back to the row.id when nothing else is available', () => {
    expect(deriveId(hit(row({ id: 'arch_x', name: 'no-id-prefix' })))).toBe('arch_x');
  });
});

describe('deriveDate', () => {
  it('returns undefined when metadataJson is empty and entryPath has no date', () => {
    expect(deriveDate(hit(row({})))).toBeUndefined();
  });

  it('extracts a date from metadataJson decisionDate', () => {
    expect(
      deriveDate(
        hit(row({ metadataJson: '{"decisionDate":"2026-05-24T00:00:00Z"}' })),
      ),
    ).toBe('2026-05-24');
  });

  it('extracts a date from metadataJson .date', () => {
    expect(deriveDate(hit(row({ metadataJson: '{"date":"2025-12-01"}' })))).toBe(
      '2025-12-01',
    );
  });

  it('extracts a date from the entryPath prefix', () => {
    expect(
      deriveDate(
        hit(row({ entryPath: 'agent-memory/2026-05-24-continuous-discipline.md' })),
      ),
    ).toBe('2026-05-24');
  });

  it('ignores malformed metadataJson without throwing', () => {
    expect(deriveDate(hit(row({ metadataJson: 'not-json-{' })))).toBeUndefined();
  });
});

describe('allocateByKindMix', () => {
  it('returns nothing when hits is empty', () => {
    expect(allocateByKindMix([], DEFAULT_KIND_MIX, 5)).toEqual([]);
  });

  it('respects the mix exactly when every bucket has enough hits', () => {
    const out = allocateByKindMix(canonicalHits(), DEFAULT_KIND_MIX, 6);
    const counts = countBy(out.map((a) => a.kind));
    expect(counts.adr).toBe(3);
    expect(counts.principle).toBe(1);
    expect(counts.lesson).toBe(1);
    expect(counts.feedback).toBe(1);
  });

  it('rolls underflowed slots forward when a kind has fewer hits than its slot', () => {
    // 4 ADRs, 0 principles, 0 lessons, 0 feedback.
    // Mix asks for {adr:1, principle:1, lesson:1, feedback:1} → 4 total.
    // Principle/lesson/feedback slots are empty so roll forward to "other"
    // … but there are no other hits either. Adr slot=1 already taken.
    // Pass-2 then re-walks the priority order picking unfilled.
    const hits = [
      hit(row({ id: 'a1', name: 'ADR-1 one' }), 0.9),
      hit(row({ id: 'a2', name: 'ADR-2 two' }), 0.8),
      hit(row({ id: 'a3', name: 'ADR-3 three' }), 0.7),
      hit(row({ id: 'a4', name: 'ADR-4 four' }), 0.6),
    ];
    const out = allocateByKindMix(
      hits,
      { adr: 1, principle: 1, lesson: 1, feedback: 1, other: 0 },
      4,
    );
    expect(out.length).toBe(4);
    expect(out.every((a) => a.kind === 'adr')).toBe(true);
  });

  it('caps total at topK even when mix sums higher', () => {
    const out = allocateByKindMix(
      canonicalHits(),
      { adr: 5, principle: 5, lesson: 5, feedback: 5, other: 5 },
      3,
    );
    expect(out.length).toBe(3);
  });

  it('preserves rank order within each kind', () => {
    const out = allocateByKindMix(canonicalHits(), DEFAULT_KIND_MIX, 6);
    const adrs = out.filter((a) => a.kind === 'adr').map((a) => a.id);
    expect(adrs).toEqual(['ADR-011', 'ADR-028', 'ADR-038']);
  });

  it('dedupes by id across rolls', () => {
    const dup = hit(row({ id: 'arch_dup', name: 'ADR-999 dup' }), 0.5);
    const hits = [dup, dup, dup];
    const out = allocateByKindMix(hits, DEFAULT_KIND_MIX, 5);
    expect(out.length).toBe(1);
    expect(out[0]?.id).toBe('ADR-999');
  });

  it('outputs kinds in priority order (adr first, other last)', () => {
    const out = allocateByKindMix(canonicalHits(), DEFAULT_KIND_MIX, 6);
    const kinds = out.map((a) => a.kind);
    // ADRs come before principle, principle before lesson, etc.
    const adrIdx = kinds.indexOf('adr');
    const principleIdx = kinds.indexOf('principle');
    const lessonIdx = kinds.indexOf('lesson');
    const feedbackIdx = kinds.indexOf('feedback');
    expect(adrIdx).toBeLessThan(principleIdx);
    expect(principleIdx).toBeLessThan(lessonIdx);
    expect(lessonIdx).toBeLessThan(feedbackIdx);
  });
});

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  const acc = {} as Record<T, number>;
  for (const v of values) acc[v] = (acc[v] ?? 0) + 1;
  return acc;
}
