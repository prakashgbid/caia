/**
 * System-prompt tests — verifies the briefing satisfies spec §11(b).
 */

import { describe, it, expect } from 'vitest';

import { ANALYTICS_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildAnalyticsSystemPrompt } from '../src/system-prompt.js';

describe('buildAnalyticsSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildAnalyticsSystemPrompt();
    const p2 = buildAnalyticsSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Analytics Architect");
  });

  it('contains the Locked stack section with privacy-first defaults', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('Plausible');
    expect(p).toContain('GA4');
    expect(p).toContain('Consent Mode v2');
    expect(p).toContain('No-PII');
    expect(p).toContain('DNT');
    expect(p).toContain('GPC');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildAnalyticsSystemPrompt();
    for (const key of ANALYTICS_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('Cookieless first');
  });

  it('contains a Refusal patterns section that rejects PII capture', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('email/phone/name');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toContain('analytics.*');
  });

  it('contains a Self-check section', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains the privacy-compliance ceiling (retention ≤ 425 days)', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toContain('425');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('does not refer to fields outside the `analytics.*` namespace', () => {
    const p = buildAnalyticsSystemPrompt();
    const foreignPrefixes = [
      'backend.apiShape',
      'database.schemaDDL',
      'security.cspPolicy',
      'a11y.wcagLevel',
      'observability.logShape'
    ];
    for (const prefix of foreignPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('size is bounded (token-budget proxy: < 20k chars)', () => {
    const p = buildAnalyticsSystemPrompt();
    expect(p).toBeDefined();
    expect(p.length).toBeLessThan(20_000);
  });
});
