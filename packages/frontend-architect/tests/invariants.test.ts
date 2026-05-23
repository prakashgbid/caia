/**
 * Cross-architect invariants — verifies Frontend's contributions to the
 * EA Reviewer's invariant registry (per spec §6.2).
 */

import { describe, it, expect } from 'vitest';

import { FRONTEND_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('FRONTEND_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(FRONTEND_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of FRONTEND_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `frontend`', () => {
    for (const inv of FRONTEND_INVARIANTS) {
      expect(inv.contributor).toBe('frontend');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of FRONTEND_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of FRONTEND_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of FRONTEND_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('FRONTEND_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of FRONTEND_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('componentTree-nonempty fails on an empty tree', () => {
    const inv = FRONTEND_INVARIANTS.find(i => i.id === 'frontend.componentTree-nonempty');
    expect(inv).toBeDefined();
    const empty = { ...goldenArch, 'frontend.componentTree': [] };
    expect(inv!.detect(empty)).toBe(false);
  });

  it('framework-is-next-app-router fails on Vite', () => {
    const inv = FRONTEND_INVARIANTS.find(i => i.id === 'frontend.framework-is-next-app-router');
    expect(inv).toBeDefined();
    const wrong = { ...goldenArch, 'frontend.framework': { name: 'vite' } };
    expect(inv!.detect(wrong)).toBe(false);
  });

  it('tokens-source-from-design fails when a referenced token is missing', () => {
    const inv = FRONTEND_INVARIANTS.find(i => i.id === 'frontend.tokens-source-from-design');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'frontend.tokens': { 'color.brand.primary': '#0f3057' },
      'frontend.designTokenReferences': { hero: ['color.brand.primary', 'space.invented'] }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('interactionStates-cover-all-seven fails when a state is missing', () => {
    const inv = FRONTEND_INVARIANTS.find(
      i => i.id === 'frontend.interactionStates-cover-all-seven'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'frontend.interactionStates': {
        cta: { hover: 'x', focus: 'x', active: 'x', error: 'x', empty: 'x', loading: 'x' }
        // disabled missing
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});
