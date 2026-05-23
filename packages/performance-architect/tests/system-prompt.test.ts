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

import { PERFORMANCE_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildPerformanceSystemPrompt } from '../src/system-prompt.js';

describe('buildPerformanceSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildPerformanceSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildPerformanceSystemPrompt();
    const p2 = buildPerformanceSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Performance Architect");
  });

  it('contains the Locked stack section anchoring Core Web Vitals + Lighthouse', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('LCP');
    expect(p).toContain('INP');
    expect(p).toContain('CLS');
    expect(p).toContain('Lighthouse');
  });

  it('declares the CWV "Good" thresholds explicitly', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('2.5s');
    expect(p).toContain('200ms');
    expect(p).toContain('0.1');
  });

  it('declares the Lighthouse floors (90/95/95/90)', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('≥ 90');
    expect(p).toContain('≥ 95');
  });

  it('declares the bundle budget defaults (130 / 170 / 250 KB gzip)', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('130KB');
    expect(p).toContain('170KB');
    expect(p).toContain('250KB');
  });

  it('declares the next/image + next/font locked stack', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('next/image');
    expect(p).toContain('next/font');
    expect(p).toContain('AVIF');
    expect(p).toContain('WebP');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('declares the Frontend upstream dependency in the Input format section', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('## Input format');
    expect(p).toContain('upstream.outputs.frontend');
    expect(p).toContain('frontend.componentTree');
    expect(p).toContain('frontend.framework');
  });

  it('references every declared owned field at least once', () => {
    const p = buildPerformanceSystemPrompt();
    for (const key of PERFORMANCE_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('LCP candidate');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('performance.*');
  });

  it('contains a Self-check section', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildPerformanceSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('does not refer to fields outside the `performance.*` owned namespace', () => {
    const p = buildPerformanceSystemPrompt();
    // The prompt references `frontend.*` fields as INPUT, so those are
    // allowed. We reject other architects' owned-output fields appearing
    // as if they were Performance's to write.
    const foreignOwnedPrefixes = [
      'backend.apiShape',
      'database.schemaDDL',
      'security.cspPolicy',
      'analytics.eventTaxonomy',
      'observability.logShape',
      'a11y.wcagLevel'
    ];
    for (const prefix of foreignOwnedPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('size is bounded (token-budget proxy: < 20k chars)', () => {
    // Token estimate: ~4 chars per token, so 20k chars ≈ 5000 tokens.
    const p = buildPerformanceSystemPrompt();
    expect(p.length).toBeLessThan(20_000);
  });
});
