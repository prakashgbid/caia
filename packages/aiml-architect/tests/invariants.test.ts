/**
 * Cross-architect invariants — verifies AI/ML's contributions to the
 * EA Reviewer's invariant registry (per spec §6.2).
 */

import { describe, it, expect } from 'vitest';

import { AIML_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('AIML_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(AIML_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of AIML_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `ai-ml`', () => {
    for (const inv of AIML_INVARIANTS) {
      expect(inv.contributor).toBe('ai-ml');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of AIML_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of AIML_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of AIML_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('AIML_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of AIML_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('modelSelection-nonempty fails on an empty selection', () => {
    const inv = AIML_INVARIANTS.find(i => i.id === 'aiml.modelSelection-nonempty');
    expect(inv).toBeDefined();
    const empty = { ...goldenArch, 'aiml.modelSelection': {} };
    expect(inv!.detect(empty)).toBe(false);
  });

  it('modelSelection-anthropic-only fails on a GPT-4 selection', () => {
    const inv = AIML_INVARIANTS.find(i => i.id === 'aiml.modelSelection-anthropic-only');
    expect(inv).toBeDefined();
    const wrong = {
      ...goldenArch,
      'aiml.modelSelection': {
        classifyInquiryIntent: { model: 'gpt-4', rationale: 'x', fallback: 'gpt-3.5' }
      }
    };
    expect(inv!.detect(wrong)).toBe(false);
  });

  it('safetyChecks-all-five-present fails when one is missing', () => {
    const inv = AIML_INVARIANTS.find(i => i.id === 'aiml.safetyChecks-all-five-present');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'aiml.aiSafetyChecks': {
        piiDetection: { posture: 'block', stage: 'pre' },
        promptInjectionGuard: { posture: 'block', stage: 'pre' },
        outputContentFilter: { posture: 'warn', stage: 'post' },
        hallucinationGate: { posture: 'warn', stage: 'post' }
        // refusalAuditLog missing
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('evalSuite-min-five-cases fails when a call type has only 3 cases', () => {
    const inv = AIML_INVARIANTS.find(i => i.id === 'aiml.evalSuite-min-five-cases');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'aiml.evalSuite': {
        classifyInquiryIntent: {
          evalCases: [
            { input: 'a', expectedOutput: '', assertions: [] },
            { input: 'b', expectedOutput: '', assertions: [] },
            { input: 'c', expectedOutput: '', assertions: [] }
          ],
          passThreshold: 0.85,
          metricKey: 'accuracy'
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('callType-set-consistent fails when a per-call-type field is missing for a declared call type', () => {
    const inv = AIML_INVARIANTS.find(i => i.id === 'aiml.callType-set-consistent');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'aiml.modelSelection': {
        classifyInquiryIntent: { model: 'haiku', rationale: 'x', fallback: 'sonnet' },
        rankInquiryUrgency: { model: 'haiku', rationale: 'x', fallback: 'sonnet' }
      }
      // promptPatterns etc still only have classifyInquiryIntent — missing rankInquiryUrgency
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('deterministic-calls-must-cache fails when temp=0 lacks an exact cache', () => {
    const inv = AIML_INVARIANTS.find(i => i.id === 'aiml.deterministic-calls-must-cache');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'aiml.cacheStrategy': {
        classifyInquiryIntent: { exact: null, semantic: null }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});
