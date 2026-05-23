/**
 * Cross-architect invariants — verifies Accessibility's contributions
 * to the EA Reviewer's invariant registry (per spec §6.2).
 *
 * Each invariant is exercised against:
 *   1. The pure A11y output (cross-arch invariants pass trivially when
 *      foreign data is absent).
 *   2. A composed view (A11y + Frontend fields) — the realistic Reviewer
 *      shape. Cross-arch invariants are fully exercised here.
 *   3. Corruption variants — each invariant must fail on its known-bad
 *      input shape.
 */

import { describe, it, expect } from 'vitest';

import { ACCESSIBILITY_INVARIANTS } from '../src/invariants.js';
import {
  composedArchitectureForInvariants,
  goldenExpectedOutput
} from './helpers/fakes.js';

describe('ACCESSIBILITY_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(ACCESSIBILITY_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of ACCESSIBILITY_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `accessibility`', () => {
    for (const inv of ACCESSIBILITY_INVARIANTS) {
      expect(inv.contributor).toBe('accessibility');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of ACCESSIBILITY_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of ACCESSIBILITY_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of ACCESSIBILITY_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('ACCESSIBILITY_INVARIANTS — predicate behaviour on the golden A11y output', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output (cross-arch checks trivially pass without Frontend data)', () => {
    for (const inv of ACCESSIBILITY_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden A11y output`).toBe(true);
    }
  });
});

describe('ACCESSIBILITY_INVARIANTS — predicate behaviour on the composed (A11y + Frontend) view', () => {
  const composed = composedArchitectureForInvariants();

  it('every invariant passes against the composed view', () => {
    for (const inv of ACCESSIBILITY_INVARIANTS) {
      const ok = inv.detect(composed);
      expect(ok, `invariant ${inv.id} should pass on the composed view`).toBe(true);
    }
  });
});

describe('ACCESSIBILITY_INVARIANTS — corruption variants', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;
  const composed = composedArchitectureForInvariants();

  it('wcagLevel-is-2.2-AA fails when level is downgraded', () => {
    const inv = ACCESSIBILITY_INVARIANTS.find(i => i.id === 'a11y.wcagLevel-is-2.2-AA');
    expect(inv).toBeDefined();
    const corrupted = { ...goldenArch, 'a11y.wcagLevel': '2.1 AA' };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('wcagLevel-is-2.2-AA fails on missing level', () => {
    const inv = ACCESSIBILITY_INVARIANTS.find(i => i.id === 'a11y.wcagLevel-is-2.2-AA');
    const corrupted = { ...goldenArch } as Record<string, unknown>;
    delete corrupted['a11y.wcagLevel'];
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('ariaLabels-cover-interactive-components fails when a CTA lacks a label', () => {
    const inv = ACCESSIBILITY_INVARIANTS.find(
      i => i.id === 'a11y.ariaLabels-cover-interactive-components'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...composed,
      'a11y.ariaLabels': {
        'hero-cta-primary': { source: 'visibleText', value: 'prop:label' }
        // hero-cta-secondary missing
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('keyboardPlan-covers-interactive-components fails when a CTA lacks a plan', () => {
    const inv = ACCESSIBILITY_INVARIANTS.find(
      i => i.id === 'a11y.keyboardPlan-covers-interactive-components'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...composed,
      'a11y.keyboardNavigationPlan': {
        'hero-cta-primary': { tabOrder: 1, keys: { Enter: 'activate' } }
        // hero-cta-secondary missing
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('colorContrast-references-real-tokens fails when a fg token is invented', () => {
    const inv = ACCESSIBILITY_INVARIANTS.find(
      i => i.id === 'a11y.colorContrast-references-real-tokens'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...composed,
      'a11y.colorContrastRequirements': {
        'hero-cta-primary.label': {
          fg: 'color.brand.invented',
          bg: 'color.brand.primary',
          minRatio: 4.5,
          rule: 'wcag-2.2-AA-1.4.3'
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('colorContrast-minRatio-is-aa-floor fails when ratio is below 3', () => {
    const inv = ACCESSIBILITY_INVARIANTS.find(
      i => i.id === 'a11y.colorContrast-minRatio-is-aa-floor'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'a11y.colorContrastRequirements': {
        'hero-cta-primary.label': {
          fg: 'color.bg.canvas',
          bg: 'color.brand.primary',
          minRatio: 2.5,
          rule: 'invalid'
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('focusManagement-dialogs-trap-focus fails when a dialog lacks trap=true', () => {
    const inv = ACCESSIBILITY_INVARIANTS.find(
      i => i.id === 'a11y.focusManagement-dialogs-trap-focus'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'a11y.ariaRoles': { 'modal-confirm': 'dialog' },
      'a11y.focusManagementNotes': {
        'modal-confirm': { trap: false, initialFocus: null, returnFocusTo: null, ringSpec: 'x' }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('focusManagement-dialogs-trap-focus passes when a dialog correctly traps', () => {
    const inv = ACCESSIBILITY_INVARIANTS.find(
      i => i.id === 'a11y.focusManagement-dialogs-trap-focus'
    );
    const ok = {
      ...goldenArch,
      'a11y.ariaRoles': { 'modal-confirm': 'dialog' },
      'a11y.focusManagementNotes': {
        'modal-confirm': {
          trap: true,
          initialFocus: '#modal-heading',
          returnFocusTo: '#open-btn',
          ringSpec: 'visible-ring'
        }
      }
    };
    expect(inv!.detect(ok)).toBe(true);
  });

  it('reducedMotion-has-alternatives fails when an animation lacks an alt', () => {
    const inv = ACCESSIBILITY_INVARIANTS.find(
      i => i.id === 'a11y.reducedMotion-has-alternatives'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'a11y.reducedMotionConsiderations': {
        animations: [
          {
            componentId: 'hero',
            durationMs: 400,
            gate: 'prefers-reduced-motion: no-preference'
            // reducedAlternative missing
          }
        ]
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});
