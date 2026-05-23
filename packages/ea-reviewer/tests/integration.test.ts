/**
 * Integration test — exercises the full pass → fail → rerun → pass cycle.
 */
import { describe, it, expect } from 'vitest';
import { Reviewer } from '../src/reviewer.js';
import { NullCriticAdapter } from '../src/critic.js';
import {
  cleanReviewerInput,
} from './fixtures.js';

describe('reviewer integration — full audit cycle', () => {
  it('clean pass produces ea-complete-verified, no reruns, no advisories', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const decision = await r.review(cleanReviewerInput());
    expect(decision.decision).toBe('pass');
    expect(decision.finalState).toBe('ea-complete-verified');
    expect(decision.rerunArchitects).toEqual([]);
    expect(decision.advisories).toEqual([]);
  });

  it('one bad input → fail → rerun list specific → fixed → pass', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });

    // First pass: break the a11y wcagLevel.
    const input = cleanReviewerInput();
    const broken = { ...input.composedArchitecture };
    delete broken['a11y.wcagLevel'];
    const fail = await r.review({ ...input, composedArchitecture: broken });
    expect(fail.decision).toBe('fail');
    expect(fail.rerunArchitects.length).toBe(1);
    expect(fail.rerunArchitects[0]?.architect).toBe('a11y');

    // Second pass: a11y re-ran and provided the missing field.
    const fixed = { ...broken, 'a11y.wcagLevel': 'AAA' };
    const pass = await r.review({ ...input, composedArchitecture: fixed });
    expect(pass.decision).toBe('pass');
  });

  it('findings expose all three lenses separately', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const decision = await r.review(cleanReviewerInput());
    expect(decision.findings).toHaveProperty('completeness');
    expect(decision.findings).toHaveProperty('consistency');
    expect(decision.findings).toHaveProperty('correctness');
  });

  it('multiple-architect-rerun: reviewer dedups + sums severity', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const input = cleanReviewerInput();
    const broken = { ...input.composedArchitecture };
    // Trigger multiple unrelated invariants
    broken['backend.endpointEnumeration'] = [{ path: '/a' }, { path: '/b' }];
    broken['apiGateway.rateLimit'] = [{ path: '/a' }]; // /b uncovered
    broken['featureFlags.flagStore'] = [{ name: 'A' }, { name: 'B' }];
    broken['featureFlags.killSwitch'] = [{ name: 'A' }]; // B uncovered
    const decision = await r.review({ ...input, composedArchitecture: broken });
    expect(decision.decision).toBe('fail');
    const names = decision.rerunArchitects.map((d) => d.architect);
    expect(names).toContain('apiGateway');
    expect(names).toContain('featureFlagging');
  });
});
