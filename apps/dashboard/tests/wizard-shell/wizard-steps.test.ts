/**
 * Wizard step catalogue + FSM ↔ step index mapping.
 */
import { describe, it, expect } from 'vitest';
import {
  WIZARD_STEPS,
  WIZARD_SLUGS,
  isWizardSlug,
  findStepBySlug,
  stepIndexForState,
} from '../../lib/wizard/steps';

describe('WIZARD_STEPS', () => {
  it('has exactly 7 steps', () => {
    expect(WIZARD_STEPS).toHaveLength(7);
  });

  it('every step has a unique slug', () => {
    const slugs = new Set(WIZARD_STEPS.map((s) => s.slug));
    expect(slugs.size).toBe(WIZARD_STEPS.length);
  });

  it('indexes are 1..7 in order', () => {
    expect(WIZARD_STEPS.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('Architecture (step 4) owns both IA FSM states', () => {
    const arch = findStepBySlug('architecture');
    expect(arch?.fsmStates).toContain('information-architecture-in-progress');
    expect(arch?.fsmStates).toContain('information-architecture-complete');
  });

  it('Interview (step 3) owns interviewing + interview-complete', () => {
    const iv = findStepBySlug('interview');
    expect(iv?.fsmStates).toContain('interviewing');
    expect(iv?.fsmStates).toContain('interview-complete');
  });

  it('atlas (step 7) is the last step', () => {
    const atlas = findStepBySlug('atlas');
    expect(atlas?.index).toBe(7);
  });
});

describe('isWizardSlug', () => {
  it('accepts every canonical slug', () => {
    for (const s of WIZARD_SLUGS) {
      expect(isWizardSlug(s)).toBe(true);
    }
  });

  it('rejects unknown slugs', () => {
    expect(isWizardSlug('unknown')).toBe(false);
    expect(isWizardSlug('')).toBe(false);
    expect(isWizardSlug('ATLAS')).toBe(false);
  });
});

describe('stepIndexForState', () => {
  it('returns the right index for IA-in-progress (step 4)', () => {
    expect(stepIndexForState('information-architecture-in-progress')).toBe(4);
  });

  it('returns the right index for interviewing (step 3)', () => {
    expect(stepIndexForState('interviewing')).toBe(3);
  });

  it('returns null for an FSM state outside the wizard', () => {
    expect(stepIndexForState('done')).toBeNull();
    expect(stepIndexForState('archived')).toBeNull();
  });

  it('handles every happy-path step', () => {
    expect(stepIndexForState('onboarding')).toBe(1);
    expect(stepIndexForState('idea-captured')).toBe(2);
    expect(stepIndexForState('proposal-generated')).toBe(5);
    expect(stepIndexForState('design-uploaded')).toBe(6);
    expect(stepIndexForState('atlas-ready')).toBe(7);
  });
});
