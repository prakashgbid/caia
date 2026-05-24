/**
 * System-prompt tests.
 */

import { describe, it, expect } from 'vitest';

import { TIME_MACHINE_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildTimeMachineSystemPrompt } from '../src/system-prompt.js';

describe('buildTimeMachineSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildTimeMachineSystemPrompt();
    const p2 = buildTimeMachineSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Time Machine Architect");
  });

  it('contains the Locked stack section', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('Cloudflare R2');
    expect(p).toContain('append-only');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildTimeMachineSystemPrompt();
    for (const key of TIME_MACHINE_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('Forward-creating revert');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('timeMachine.*');
  });

  it('contains a Self-check section', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('calls out the forward-creating revert invariant explicitly', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(p).toContain('forward-creating');
  });

  it('does not refer to fields outside the `timeMachine.*` namespace', () => {
    const p = buildTimeMachineSystemPrompt();
    const foreignPrefixes = [
      'frontend.componentTree',
      'a11y.wcagLevel',
      'security.cspPolicy',
      'analytics.eventTaxonomy',
      'observability.logShape'
    ];
    for (const prefix of foreignPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('size is bounded (token-budget proxy: < 16k chars)', () => {
    const p = buildTimeMachineSystemPrompt();
    expect(p.length).toBeLessThan(16_000);
  });
});
