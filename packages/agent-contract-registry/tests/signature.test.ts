import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ComposedSectionEntry, StoryScope } from '@chiefaia/ticket-template';
import { computeSignature } from '../src/signature';

function entry(name: string, mut: Partial<ComposedSectionEntry> = {}): ComposedSectionEntry {
  return {
    spec: {
      name,
      description: 'd',
      purpose: 'p',
      dataShape: z.object({}).passthrough(),
      required: true,
      rubric: { severityOnFail: 'hard', fixHint: 'fix' },
      examples: [{ good: {}, bad: {}, badRationale: 'r' }],
    },
    effectiveRubric: { severityOnFail: 'hard', fixHint: 'fix' },
    effectiveRequired: true,
    ownerAgent: 'po',
    contractId: 'po-agent.v1',
    ...mut,
  };
}

function mapOf(...entries: ComposedSectionEntry[]): Map<string, ComposedSectionEntry> {
  const m = new Map<string, ComposedSectionEntry>();
  for (const e of entries) m.set(e.spec.name, e);
  return m;
}

describe('computeSignature', () => {
  it('returns a 64-char lowercase hex string', () => {
    const sig = computeSignature('story', mapOf(entry('scope')));
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is stable across runs given same input', () => {
    const a = computeSignature('story', mapOf(entry('scope'), entry('ac')));
    const b = computeSignature('story', mapOf(entry('scope'), entry('ac')));
    expect(a).toBe(b);
  });

  it('is order-independent for the sections map', () => {
    const a = computeSignature('story', mapOf(entry('scope'), entry('ac')));
    const b = computeSignature('story', mapOf(entry('ac'), entry('scope')));
    expect(a).toBe(b);
  });

  it('differs when scope differs', () => {
    const a = computeSignature('story', mapOf(entry('scope')));
    const b = computeSignature('task' as StoryScope, mapOf(entry('scope')));
    expect(a).not.toBe(b);
  });

  it('differs when rubric severity differs', () => {
    const a = computeSignature('story', mapOf(entry('scope', { effectiveRubric: { severityOnFail: 'hard', fixHint: 'fix' } })));
    const b = computeSignature('story', mapOf(entry('scope', { effectiveRubric: { severityOnFail: 'soft', fixHint: 'fix' } })));
    expect(a).not.toBe(b);
  });

  it('differs when required flag differs', () => {
    const a = computeSignature('story', mapOf(entry('scope', { effectiveRequired: true })));
    const b = computeSignature('story', mapOf(entry('scope', { effectiveRequired: false })));
    expect(a).not.toBe(b);
  });

  it('is independent of dataShape internals (Zod is not stably hashable)', () => {
    const a = computeSignature('story', mapOf(entry('scope', { spec: { ...entry('scope').spec, dataShape: z.string() } })));
    const b = computeSignature('story', mapOf(entry('scope', { spec: { ...entry('scope').spec, dataShape: z.number() } })));
    expect(a).toBe(b);
  });
});
