/**
 * System-prompt tests — verifies the briefing satisfies spec §11(b):
 *
 *   - Parses cleanly as text (non-empty, no obvious corruption).
 *   - References every declared owned field at least once.
 *   - Contains the standard architect-output JSON schema instruction.
 *   - Under a reasonable size (token budget proxy).
 *   - Idempotent (pure function).
 */

import { describe, it, expect } from 'vitest';

import { A11Y_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildAccessibilitySystemPrompt } from '../src/system-prompt.js';

describe('buildAccessibilitySystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildAccessibilitySystemPrompt();
    const p2 = buildAccessibilitySystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Accessibility Architect");
  });

  it('contains the Locked stack section anchoring WCAG 2.2 AA + axe-core', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('WCAG 2.2 AA');
    expect(p).toContain('axe-core');
  });

  it('declares the AA contrast floors explicitly', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(p).toContain('4.5:1');
    expect(p).toContain('3:1');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('declares the Frontend upstream dependency in the Input format section', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(p).toContain('## Input format');
    expect(p).toContain('upstream.outputs.frontend');
    expect(p).toContain('frontend.componentTree');
    expect(p).toContain('frontend.interactionStates');
  });

  it('references every declared owned field at least once', () => {
    const p = buildAccessibilitySystemPrompt();
    for (const key of A11Y_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('Semantic-first');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('a11y.*');
  });

  it('contains a Self-check section', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildAccessibilitySystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('does not refer to fields outside the `a11y.*` owned namespace', () => {
    const p = buildAccessibilitySystemPrompt();
    // The prompt references `frontend.*` fields as INPUT, so those are
    // allowed. We reject other architects' owned-output fields appearing
    // as if they were A11y's to write.
    const foreignOwnedPrefixes = [
      'backend.apiShape',
      'database.schemaDDL',
      'security.cspPolicy',
      'analytics.eventTaxonomy',
      'observability.logShape'
    ];
    for (const prefix of foreignOwnedPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('size is bounded (token-budget proxy: < 16k chars)', () => {
    // Token estimate: ~4 chars per token, so 16k chars ≈ 4000 tokens.
    const p = buildAccessibilitySystemPrompt();
    expect(p.length).toBeLessThan(16_000);
  });
});
