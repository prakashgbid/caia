import { describe, expect, it } from 'vitest';

import {
  IA_CRITIC_SCORE_FLOOR,
  IA_INPUT_COMPLETENESS_FLOOR,
  isIaInput,
  isIaOutput,
} from '../src/types.js';
import { synthesiseSkeletonOutput } from '../src/agent.js';
import { buildIaInput } from './fixtures.js';

describe('IA types — constants', () => {
  it('IA_CRITIC_SCORE_FLOOR is 85 per spec §6.2', () => {
    expect(IA_CRITIC_SCORE_FLOOR).toBe(85);
  });

  it('IA_INPUT_COMPLETENESS_FLOOR is 80 per spec §6.2', () => {
    expect(IA_INPUT_COMPLETENESS_FLOOR).toBe(80);
  });
});

describe('IA types — isIaInput', () => {
  it('accepts a canonical input', () => {
    expect(isIaInput(buildIaInput())).toBe(true);
  });

  it('rejects null', () => {
    expect(isIaInput(null)).toBe(false);
  });

  it('rejects a string', () => {
    expect(isIaInput('whatever')).toBe(false);
  });

  it('rejects an object missing projectId', () => {
    const partial: Record<string, unknown> = { ...buildIaInput() };
    delete partial.projectId;
    expect(isIaInput(partial)).toBe(false);
  });

  it('rejects an unknown projectType', () => {
    expect(isIaInput(buildIaInput({ projectType: 'unknown' as never }))).toBe(false);
  });

  it('rejects when tenantContext is null', () => {
    expect(
      isIaInput(buildIaInput({ tenantContext: null as never })),
    ).toBe(false);
  });
});

describe('IA types — isIaOutput', () => {
  it('accepts a synthesised skeleton output', () => {
    const out = synthesiseSkeletonOutput(buildIaInput(), () => new Date('2026-05-25T12:00:00Z'));
    expect(isIaOutput(out)).toBe(true);
  });

  it('rejects null', () => {
    expect(isIaOutput(null)).toBe(false);
  });

  it('rejects when pagesCatalogue is missing', () => {
    const out = synthesiseSkeletonOutput(buildIaInput()) as Record<string, unknown>;
    delete out.pagesCatalogue;
    expect(isIaOutput(out)).toBe(false);
  });
});
