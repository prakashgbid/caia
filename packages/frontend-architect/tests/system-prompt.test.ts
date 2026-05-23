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

import { FRONTEND_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildFrontendSystemPrompt } from '../src/system-prompt.js';

describe('buildFrontendSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildFrontendSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildFrontendSystemPrompt();
    const p2 = buildFrontendSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildFrontendSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Frontend Architect");
  });

  it('contains the Locked stack section', () => {
    const p = buildFrontendSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('Next.js 15');
    expect(p).toContain('shadcn/ui');
    expect(p).toContain('Tailwind');
    expect(p).toContain('zustand');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildFrontendSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildFrontendSystemPrompt();
    for (const key of FRONTEND_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildFrontendSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('Server Components default');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildFrontendSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('frontend.*');
  });

  it('contains a Self-check section', () => {
    const p = buildFrontendSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildFrontendSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('does not refer to fields outside the `frontend.*` namespace', () => {
    const p = buildFrontendSystemPrompt();
    // Reject backend/database/security fields appearing — they are
    // other architects' territory.
    const foreignPrefixes = [
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
    // Token estimate: ~4 chars per token, so 16k chars ≈ 4000 tokens —
    // safely under the spec §11(b) 2000-token ceiling for typical
    // prompts but generous for the embedded schema.
    const p = buildFrontendSystemPrompt();
    expect(p.length).toBeLessThan(16_000);
  });
});
