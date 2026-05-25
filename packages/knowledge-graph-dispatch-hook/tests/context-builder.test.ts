import { describe, expect, it } from 'vitest';

import {
  buildPreamble,
  groupByKind,
  PREAMBLE_HEADER,
  PREAMBLE_INTRO,
  prependPreamble,
  renderArtifactLine,
} from '../src/context-builder.js';
import type { RetrievedArtifact } from '../src/types.js';

function art(over: Partial<RetrievedArtifact>): RetrievedArtifact {
  return {
    kind: 'adr',
    id: 'ADR-001',
    title: 'Test',
    score: 0.9,
    raw: null,
    ...over,
  };
}

describe('buildPreamble', () => {
  it('returns empty string for empty input', () => {
    expect(buildPreamble([])).toBe('');
  });

  it('includes the canonical header and intro', () => {
    const out = buildPreamble([art({})]);
    expect(out.startsWith(PREAMBLE_HEADER)).toBe(true);
    expect(out).toContain(PREAMBLE_INTRO);
  });

  it('renders an ADRs section when only ADR hits are present', () => {
    const out = buildPreamble([
      art({ kind: 'adr', id: 'ADR-011', title: 'Event-first state' }),
    ]);
    expect(out).toContain('### ADRs');
    expect(out).toContain('- [ADR-011] Event-first state');
    expect(out).not.toContain('### Principles');
  });

  it('renders sections in spec order ADR Principle Lesson Feedback', () => {
    const out = buildPreamble([
      art({ kind: 'feedback', id: 'feedback-x', title: '', date: '2026-05-24' }),
      art({ kind: 'lesson', id: 'L01', title: 'lesson title' }),
      art({ kind: 'principle', id: 'P3', title: 'No timelines' }),
      art({ kind: 'adr', id: 'ADR-011', title: 'Event-first' }),
    ]);
    const order = ['### ADRs', '### Principles', '### Lessons', '### Recent feedback memories'];
    let cursor = 0;
    for (const h of order) {
      const idx = out.indexOf(h, cursor);
      expect(idx).toBeGreaterThan(-1);
      cursor = idx + h.length;
    }
  });

  it('omits empty sections entirely', () => {
    const out = buildPreamble([
      art({ kind: 'adr', id: 'ADR-1', title: 'one' }),
    ]);
    expect(out).not.toContain('### Principles');
    expect(out).not.toContain('### Lessons');
    expect(out).not.toContain('### Recent feedback memories');
    expect(out).not.toContain('### Other');
  });

  it('renders the Recent feedback memories header verbatim from the spec', () => {
    const out = buildPreamble([
      art({ kind: 'feedback', id: 'feedback-y', title: '' }),
    ]);
    expect(out).toContain('### Recent feedback memories');
  });

  it('renders the Other section for non-canonical kinds', () => {
    const out = buildPreamble([
      art({ kind: 'other', id: 'thing', title: 'a thing' }),
    ]);
    expect(out).toContain('### Other');
    expect(out).toContain('- [thing] a thing');
  });
});

describe('renderArtifactLine', () => {
  it('formats ADR lines as - [ID] title', () => {
    expect(
      renderArtifactLine(
        art({ id: 'ADR-011', title: 'Event-first state with database as projection' }),
        'adr',
      ),
    ).toBe('- [ADR-011] Event-first state with database as projection');
  });

  it('formats principle lines as - [ID] title', () => {
    expect(
      renderArtifactLine(art({ id: 'P3', title: 'No timelines, ever' }), 'principle'),
    ).toBe('- [P3] No timelines, ever');
  });

  it('formats feedback lines without title and with date suffix', () => {
    expect(
      renderArtifactLine(
        art({ id: 'feedback-continuous-discipline-problem', title: 'ignored', date: '2026-05-24' }),
        'feedback',
      ),
    ).toBe('- [feedback-continuous-discipline-problem] (2026-05-24)');
  });

  it('formats feedback lines without title and without date when none', () => {
    expect(
      renderArtifactLine(art({ id: 'feedback-x', title: '' }), 'feedback'),
    ).toBe('- [feedback-x]');
  });

  it('collapses whitespace and trims in titles', () => {
    const out = renderArtifactLine(
      art({ id: 'ADR-1', title: '  multi\n line   title  ' }),
      'adr',
    );
    expect(out).toBe('- [ADR-1] multi line title');
  });

  it('escapes closing brackets in titles', () => {
    const out = renderArtifactLine(
      art({ id: 'ADR-1', title: 'Title with [brackets] inside' }),
      'adr',
    );
    expect(out).toContain('\\]');
  });

  it('strips brackets from ids so [id] stays parseable', () => {
    const out = renderArtifactLine(art({ id: '[weird]id', title: 't' }), 'adr');
    expect(out).toBe('- [weirdid] t');
  });

  it('caps title length at 200 chars with an ellipsis', () => {
    const longTitle = 'x'.repeat(500);
    const out = renderArtifactLine(art({ id: 'ADR-1', title: longTitle }), 'adr');
    expect(out.length).toBeLessThanOrEqual(210);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles missing title by emitting just the id', () => {
    expect(renderArtifactLine(art({ id: 'ADR-1', title: '' }), 'adr')).toBe('- [ADR-1]');
  });
});

describe('groupByKind', () => {
  it('returns empty arrays for every kind on empty input', () => {
    const g = groupByKind([]);
    expect(g.adr).toEqual([]);
    expect(g.principle).toEqual([]);
    expect(g.lesson).toEqual([]);
    expect(g.feedback).toEqual([]);
    expect(g.other).toEqual([]);
  });

  it('preserves input order within each kind', () => {
    const g = groupByKind([
      art({ kind: 'adr', id: 'ADR-2' }),
      art({ kind: 'adr', id: 'ADR-1' }),
      art({ kind: 'principle', id: 'P1' }),
    ]);
    expect(g.adr.map((a) => a.id)).toEqual(['ADR-2', 'ADR-1']);
    expect(g.principle.map((a) => a.id)).toEqual(['P1']);
  });
});

describe('prependPreamble', () => {
  it('returns the brief unchanged when preamble is empty', () => {
    expect(prependPreamble('hello', '')).toBe('hello');
  });

  it('joins preamble + double-newline + brief', () => {
    expect(prependPreamble('hello', 'PRE')).toBe('PRE\n\nhello');
  });

  it('handles an empty brief by emitting PRE plus two newlines', () => {
    expect(prependPreamble('', 'PRE')).toBe('PRE\n\n');
  });
});
