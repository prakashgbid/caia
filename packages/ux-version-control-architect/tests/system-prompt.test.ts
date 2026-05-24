/**
 * System-prompt tests.
 */

import { describe, it, expect } from 'vitest';

import { UX_VERSION_CONTROL_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUxVersionControlSystemPrompt } from '../src/system-prompt.js';

describe('buildUxVersionControlSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildUxVersionControlSystemPrompt();
    const p2 = buildUxVersionControlSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's UX Version Control Architect");
  });

  it('contains the Locked stack section', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('Cloudflare R2');
    expect(p).toContain('append-only');
    expect(p).toContain('ULID');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildUxVersionControlSystemPrompt();
    for (const key of UX_VERSION_CONTROL_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('Forward-creating revert');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('uxVersionControl.*');
  });

  it('contains a Self-check section', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('calls out the forward-creating revert invariant explicitly', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('forward-creating');
  });

  it('calls out the preservation guarantee (spec §2.15) explicitly', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('preserved forever');
    expect(p).toContain('immutable-r2-storage');
  });

  it('declares the five canonical diff layers', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toContain('tree');
    expect(p).toContain('token');
    expect(p).toContain('copy');
    expect(p).toContain('asset');
    expect(p).toContain('interactivity');
  });

  it('declares distinct-from-Time-Machine framing', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p).toMatch(/Time Machine|time-machine/);
    expect(p).toContain('DESIGN-level versioning');
  });

  it('does not refer to fields outside the `uxVersionControl.*` namespace', () => {
    const p = buildUxVersionControlSystemPrompt();
    const foreignPrefixes = [
      'frontend.componentTree',
      'a11y.wcagLevel',
      'security.cspPolicy',
      'analytics.eventTaxonomy',
      'observability.logShape',
      'timeMachine.versioningStrategy',
      'timeMachine.snapshotRetention',
      'timeMachine.dataConsistency'
    ];
    for (const prefix of foreignPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('size is bounded (token-budget proxy: < 16k chars)', () => {
    const p = buildUxVersionControlSystemPrompt();
    expect(p.length).toBeLessThan(16_000);
  });
});
