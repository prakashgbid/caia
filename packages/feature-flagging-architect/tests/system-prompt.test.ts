/**
 * System-prompt tests — verifies the briefing satisfies spec §11(b).
 */

import { describe, it, expect } from 'vitest';

import { FEATURE_FLAGGING_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildFeatureFlaggingSystemPrompt } from '../src/system-prompt.js';

describe('buildFeatureFlaggingSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildFeatureFlaggingSystemPrompt();
    const p2 = buildFeatureFlaggingSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Feature Flagging Architect");
  });

  it('explicitly disclaims component code and backend logic responsibilities', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('DO NOT write component code or backend logic');
    expect(p).toContain('DO specify what gets toggleable');
  });

  it('contains the Locked rollout posture section', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('## Locked rollout posture');
    expect(p).toContain('OpenFeature');
    expect(p).toContain('canary');
    expect(p).toContain('30-min soak');
    expect(p).toContain('Audit');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
    expect(p).toContain('featureFlagging');
  });

  it('references every declared owned field at least once', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    for (const key of FEATURE_FLAGGING_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('Read upstream before deciding what to flag');
    expect(p).toContain('Default to "off" in production');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('featureFlags.*');
  });

  it('contains a Self-check section', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('does not refer to fields outside the `featureFlags.*` namespace', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    const foreignPrefixes = [
      'database.schemaDDL',
      'security.cspPolicy',
      'analytics.eventTaxonomy',
      'observability.logShape',
      'seo.canonicalUrl'
    ];
    for (const prefix of foreignPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('references upstream Frontend componentTree + Backend apiEndpoints (depends-on signal)', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('frontend.componentTree');
    expect(p).toContain('backend.apiEndpoints');
  });

  it('size is bounded (token-budget proxy: < 16k chars)', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p.length).toBeLessThan(16_000);
  });

  it('mentions material-blast-radius categories (auth, payments, ai-inference)', () => {
    const p = buildFeatureFlaggingSystemPrompt();
    expect(p).toContain('auth');
    expect(p).toContain('payments');
    expect(p).toContain('ai-inference');
  });
});
