/**
 * System-prompt tests — verifies the briefing satisfies spec §11(b):
 *
 *   - Non-empty string.
 *   - References every declared owned field at least once.
 *   - Contains the standard architect-output JSON schema instruction.
 *   - Under a reasonable size (token budget proxy).
 *   - Idempotent (pure function).
 */

import { describe, it, expect } from 'vitest';

import { SEO_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildSeoSystemPrompt } from '../src/system-prompt.js';

describe('buildSeoSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildSeoSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildSeoSystemPrompt();
    const p2 = buildSeoSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildSeoSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's SEO Architect");
  });

  it('contains the Locked SEO posture section', () => {
    const p = buildSeoSystemPrompt();
    expect(p).toContain('## Locked SEO posture');
    expect(p).toContain('schema.org');
    expect(p).toContain('1200×630');
    expect(p).toContain('canonical');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildSeoSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildSeoSystemPrompt();
    for (const key of SEO_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('lists the Rich Results @type vocabulary', () => {
    const p = buildSeoSystemPrompt();
    expect(p).toContain('Article');
    expect(p).toContain('BlogPosting');
    expect(p).toContain('FAQPage');
    expect(p).toContain('Person');
    expect(p).toContain('Organization');
    expect(p).toContain('Product');
    expect(p).toContain('WebSite');
  });

  it('contains the Decision heuristics section', () => {
    const p = buildSeoSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('pageType');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildSeoSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('seo.*');
  });

  it('contains a Self-check section', () => {
    const p = buildSeoSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildSeoSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('does not refer to fields outside the `seo.*` namespace', () => {
    const p = buildSeoSystemPrompt();
    // Reject other architects' field paths from appearing — they are
    // other architects' territory.
    const foreignPrefixes = [
      'frontend.componentTree',
      'backend.apiShape',
      'database.schemaDDL',
      'security.cspPolicy',
      'performance.imagePolicy',
      'a11y.conformanceMap'
    ];
    for (const prefix of foreignPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('size is bounded (token-budget proxy: < 16k chars)', () => {
    const p = buildSeoSystemPrompt();
    expect(p.length).toBeLessThan(16_000);
  });
});
