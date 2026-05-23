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

import { AIML_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildAimlSystemPrompt } from '../src/system-prompt.js';

describe('buildAimlSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildAimlSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildAimlSystemPrompt();
    const p2 = buildAimlSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildAimlSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's AI/ML Architect");
  });

  it('contains the Locked stack section with Anthropic Claude lineup', () => {
    const p = buildAimlSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('Haiku');
    expect(p).toContain('Sonnet');
    expect(p).toContain('Opus');
    expect(p).toContain('Anthropic');
  });

  it('contains the cost tier definition T1/T2/T3', () => {
    const p = buildAimlSystemPrompt();
    expect(p).toContain('T1');
    expect(p).toContain('T2');
    expect(p).toContain('T3');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildAimlSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildAimlSystemPrompt();
    for (const key of AIML_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildAimlSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('Default Sonnet');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildAimlSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('aiml.*');
  });

  it('contains a Self-check section', () => {
    const p = buildAimlSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildAimlSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('does not refer to fields outside the `aiml.*` namespace', () => {
    const p = buildAimlSystemPrompt();
    // Reject frontend/backend/database/security fields appearing — they are
    // other architects' territory.
    const foreignPrefixes = [
      'frontend.componentTree',
      'backend.apiShape',
      'database.schemaDDL',
      'security.cspPolicy',
      'analytics.eventTaxonomy',
      'observability.logShape'
    ];
    for (const prefix of foreignPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('size is bounded (token-budget proxy: < 16k chars)', () => {
    const p = buildAimlSystemPrompt();
    expect(p.length).toBeLessThan(16_000);
  });

  it('names the five required safety checks', () => {
    const p = buildAimlSystemPrompt();
    expect(p).toContain('piiDetection');
    expect(p).toContain('promptInjectionGuard');
    expect(p).toContain('outputContentFilter');
    expect(p).toContain('hallucinationGate');
    expect(p).toContain('refusalAuditLog');
  });
});
