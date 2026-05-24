/**
 * System-prompt tests — verifies the briefing satisfies spec §11(b).
 */

import { describe, it, expect } from 'vitest';

import { AB_TESTING_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildABTestingSystemPrompt } from '../src/system-prompt.js';

describe('buildABTestingSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildABTestingSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildABTestingSystemPrompt();
    const p2 = buildABTestingSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's A/B Testing Architect");
  });

  it('contains the Locked stack section with statistical defaults', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('two-proportion z-test');
    expect(p).toContain('α=0.05');
    expect(p).toContain('power=0.8');
    expect(p).toContain('Sample-Ratio-Mismatch');
    expect(p).toContain('SRM');
  });

  it('mentions sticky-by-user-id variant routing as the default', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('sticky-by-user-id');
  });

  it('mentions the 28-day duration cap', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('28 days');
  });

  it('mentions the 5% holdout default', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('5%');
    expect(p).toContain('holdout');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildABTestingSystemPrompt();
    for (const key of AB_TESTING_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('falsifiable');
  });

  it('contains a Refusal patterns section that rejects skipping SRM', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('SRM');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('abTesting.*');
  });

  it('contains a Self-check section', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains the sample-size formula or its derivation', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('perVariantN');
    expect(p.toLowerCase()).toMatch(/two-proportion|closed[- ]form|power[- ]?calc/);
  });

  it('contains the all-criteria auto-promote rule', () => {
    const p = buildABTestingSystemPrompt();
    expect(p.toLowerCase()).toContain('auto-promote');
    expect(p).toContain('SRM pass');
    expect(p).toContain('guardrails');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('does not refer to fields outside the `abTesting.*` namespace', () => {
    const p = buildABTestingSystemPrompt();
    const foreignPrefixes = [
      'backend.apiShape',
      'database.schemaDDL',
      'security.cspPolicy',
      'a11y.wcagLevel',
      'observability.logShape',
      'frontend.componentTree'
    ];
    for (const prefix of foreignPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('size is bounded (token-budget proxy: < 25k chars)', () => {
    const p = buildABTestingSystemPrompt();
    expect(p).toBeDefined();
    expect(p.length).toBeLessThan(25_000);
  });
});
