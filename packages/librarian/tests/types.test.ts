import { describe, expect, it } from 'vitest';

import { ALL_PRECEDENT_KINDS, isPrecedentKind } from '../src/types.js';

describe('PrecedentKind', () => {
  it('exposes a frozen list of every recognized kind', () => {
    expect(ALL_PRECEDENT_KINDS.length).toBeGreaterThan(10);
    expect(Object.isFrozen(ALL_PRECEDENT_KINDS)).toBe(true);
    // every kind appears once
    expect(new Set(ALL_PRECEDENT_KINDS).size).toBe(ALL_PRECEDENT_KINDS.length);
  });

  it('accepts every listed kind via the type guard', () => {
    for (const k of ALL_PRECEDENT_KINDS) {
      expect(isPrecedentKind(k)).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(isPrecedentKind('unknown')).toBe(false);
    expect(isPrecedentKind('directives')).toBe(false); // close but not exact
    expect(isPrecedentKind('')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isPrecedentKind(42)).toBe(false);
    expect(isPrecedentKind(null)).toBe(false);
    expect(isPrecedentKind(undefined)).toBe(false);
    expect(isPrecedentKind({})).toBe(false);
  });

  it('includes the canonical Mentor kinds (feedback + proposal)', () => {
    expect(isPrecedentKind('feedback')).toBe(true);
    expect(isPrecedentKind('proposal')).toBe(true);
  });

  it('includes the broader Librarian kinds (report, directive, master, etc.)', () => {
    expect(isPrecedentKind('directive')).toBe(true);
    expect(isPrecedentKind('report')).toBe(true);
    expect(isPrecedentKind('master')).toBe(true);
    expect(isPrecedentKind('landscape')).toBe(true);
  });

  it('falls through to "other" for unclassifiable kinds', () => {
    expect(isPrecedentKind('other')).toBe(true);
  });
});
