import { describe, expect, it } from 'vitest';
import type { SpawnClaudeInput, SpawnClaudeResult } from '@chiefaia/claude-spawner';
import { SpawnClaudeConstraintError } from '@chiefaia/claude-spawner';

import {
  InfoArchitectAgent,
  synthesiseSkeletonOutput,
} from '../src/agent.js';
import { InfoArchitectError, isInfoArchitectError } from '../src/errors.js';
import {
  IA_INPUT_COMPLETENESS_FLOOR,
  isIaOutput,
} from '../src/types.js';
import { buildIaInput } from './fixtures.js';

const CLOCK = (): Date => new Date('2026-05-25T12:00:00.000Z');

function envelope(text: string): string {
  return JSON.stringify({
    type: 'result',
    is_error: false,
    result: text,
  });
}

describe('InfoArchitectAgent — input validation', () => {
  it('rejects an invalid input shape', async () => {
    const agent = new InfoArchitectAgent({
      scriptedLlm: async () => '{}',
      clock: CLOCK,
    });
    await expect(
      agent.design({} as never),
    ).rejects.toBeInstanceOf(InfoArchitectError);
  });

  it('rejects when completeness is below the IA floor', async () => {
    const agent = new InfoArchitectAgent({
      scriptedLlm: async () => '{}',
      clock: CLOCK,
    });
    const input = buildIaInput({
      businessPlan: {
        ...buildIaInput().businessPlan,
        completenessScore: IA_INPUT_COMPLETENESS_FLOOR - 1,
      },
    });
    await expect(agent.design(input)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('accepts a completeness score exactly at the floor', async () => {
    const agent = new InfoArchitectAgent({
      scriptedLlm: async () =>
        JSON.stringify(synthesiseSkeletonOutput(buildIaInput(), CLOCK)),
      clock: CLOCK,
    });
    const input = buildIaInput({
      businessPlan: {
        ...buildIaInput().businessPlan,
        completenessScore: IA_INPUT_COMPLETENESS_FLOOR,
      },
    });
    const out = await agent.design(input);
    expect(isIaOutput(out)).toBe(true);
  });
});

describe('InfoArchitectAgent — scripted LLM happy path', () => {
  it('returns the scripted output verbatim', async () => {
    const expected = synthesiseSkeletonOutput(buildIaInput(), CLOCK);
    const agent = new InfoArchitectAgent({
      scriptedLlm: async () => JSON.stringify(expected),
      clock: CLOCK,
    });
    const out = await agent.design(buildIaInput());
    expect(out.pagesCatalogue.revisionId).toBe(expected.pagesCatalogue.revisionId);
    expect(out.componentsLibrary.components.length).toBe(
      expected.componentsLibrary.components.length,
    );
  });

  it('hands the system prompt to the scripted LLM', async () => {
    let capturedPrompt = '';
    const agent = new InfoArchitectAgent({
      scriptedLlm: async (p) => {
        capturedPrompt = p;
        return JSON.stringify(synthesiseSkeletonOutput(buildIaInput(), CLOCK));
      },
      clock: CLOCK,
    });
    await agent.design(buildIaInput());
    expect(capturedPrompt).toContain('Information Architect');
    expect(capturedPrompt).toContain('Archetype A');
  });
});

describe('InfoArchitectAgent — Claude spawner subscription-only', () => {
  it('throws subscription_only_violation when api-key constraint fires', async () => {
    const spawnFn = async (
      _input: SpawnClaudeInput,
    ): Promise<SpawnClaudeResult> => {
      throw new SpawnClaudeConstraintError(
        'api-key-present',
        'ANTHROPIC_API_KEY is set in the calling process',
      );
    };
    const agent = new InfoArchitectAgent({
      spawnClaudeFn: spawnFn,
      clock: CLOCK,
    });
    await expect(agent.design(buildIaInput())).rejects.toMatchObject({
      code: 'subscription_only_violation',
    });
  });

  it('throws llm_call_failed when the spawner returns ok=false', async () => {
    const spawnFn = async (
      _input: SpawnClaudeInput,
    ): Promise<SpawnClaudeResult> => ({
      ok: false,
      rc: 1,
      stdout: '',
      stderr: 'binary missing',
      timedOut: false,
      durationMs: 5,
      diagnostic: 'claude binary not found on PATH',
      accountId: null,
    });
    const agent = new InfoArchitectAgent({
      spawnClaudeFn: spawnFn,
      fallbackToSkeleton: false,
      clock: CLOCK,
    });
    await expect(agent.design(buildIaInput())).rejects.toMatchObject({
      code: 'llm_call_failed',
    });
  });

  it('throws llm_parse_error when the envelope is malformed', async () => {
    const spawnFn = async (
      _input: SpawnClaudeInput,
    ): Promise<SpawnClaudeResult> => ({
      ok: true,
      rc: 0,
      stdout: 'not-json',
      stderr: '',
      timedOut: false,
      durationMs: 5,
      diagnostic: null,
      accountId: null,
    });
    const agent = new InfoArchitectAgent({
      spawnClaudeFn: spawnFn,
      fallbackToSkeleton: false,
      clock: CLOCK,
    });
    await expect(agent.design(buildIaInput())).rejects.toMatchObject({
      code: 'llm_parse_error',
    });
  });

  it('parses a valid envelope and returns the output', async () => {
    const expected = synthesiseSkeletonOutput(buildIaInput(), CLOCK);
    const spawnFn = async (
      _input: SpawnClaudeInput,
    ): Promise<SpawnClaudeResult> => ({
      ok: true,
      rc: 0,
      stdout: envelope(JSON.stringify(expected)),
      stderr: '',
      timedOut: false,
      durationMs: 100,
      diagnostic: null,
      accountId: null,
    });
    const agent = new InfoArchitectAgent({
      spawnClaudeFn: spawnFn,
      clock: CLOCK,
    });
    const out = await agent.design(buildIaInput());
    expect(out.componentsLibrary.components.length).toBeGreaterThan(0);
  });
});

describe('InfoArchitectAgent — skeleton fallback', () => {
  it('falls back to skeleton output when LLM returns unparsable JSON', async () => {
    const agent = new InfoArchitectAgent({
      scriptedLlm: async () => 'NOT JSON',
      clock: CLOCK,
    });
    const out = await agent.design(buildIaInput());
    expect(isIaOutput(out)).toBe(true);
    expect(out.componentsLibrary.components.length).toBeGreaterThanOrEqual(5);
  });

  it('does NOT fall back when fallbackToSkeleton=false', async () => {
    const agent = new InfoArchitectAgent({
      scriptedLlm: async () => 'NOT JSON',
      fallbackToSkeleton: false,
      clock: CLOCK,
    });
    await expect(agent.design(buildIaInput())).rejects.toMatchObject({
      code: 'llm_parse_error',
    });
  });

  it('falls back when the output shape is invalid', async () => {
    const agent = new InfoArchitectAgent({
      scriptedLlm: async () => JSON.stringify({ pagesCatalogue: 'wrong' }),
      clock: CLOCK,
    });
    const out = await agent.design(buildIaInput());
    expect(isIaOutput(out)).toBe(true);
  });
});

describe('synthesiseSkeletonOutput', () => {
  it('produces all 5 credential-archetype components', () => {
    const out = synthesiseSkeletonOutput(buildIaInput(), CLOCK);
    const archetypes = out.componentsLibrary.components
      .map((c) => c.credentialArchetype)
      .filter((x): x is NonNullable<typeof x> => x !== undefined);
    expect(archetypes.length).toBe(5);
    expect(new Set(archetypes).size).toBe(5);
  });

  it('the skeleton output is shape-valid', () => {
    const out = synthesiseSkeletonOutput(buildIaInput(), CLOCK);
    expect(isIaOutput(out)).toBe(true);
  });

  it('component ids match the cmp-<tier>-<slug> pattern', () => {
    const out = synthesiseSkeletonOutput(buildIaInput(), CLOCK);
    for (const c of out.componentsLibrary.components) {
      expect(c.id).toMatch(/^cmp-[a-z]+-[a-z0-9-]+$/);
    }
  });

  it('the pages catalogue page slug is a valid Atlas DOM-ID prefix', () => {
    const out = synthesiseSkeletonOutput(buildIaInput(), CLOCK);
    expect(out.pagesCatalogue.pages[0]!.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('isInfoArchitectError narrows correctly', () => {
    expect(isInfoArchitectError(new InfoArchitectError('llm_call_failed', 'x'))).toBe(true);
    expect(isInfoArchitectError(new Error('x'))).toBe(false);
    expect(isInfoArchitectError(null)).toBe(false);
  });
});
