import { describe, it, expect } from 'vitest';

import {
  buildSpawnPrompt,
  createDefaultSpawner,
  modelTagFor,
  type AuthorSpawnerFn
} from '../src/spawner.js';

describe('modelTagFor', () => {
  it('maps haiku → claude-haiku-4-5', () => {
    expect(modelTagFor('haiku')).toBe('claude-haiku-4-5');
  });

  it('maps opus → claude-opus-4-6', () => {
    expect(modelTagFor('opus')).toBe('claude-opus-4-6');
  });

  it('maps sonnet → claude-sonnet-4-6 (default)', () => {
    expect(modelTagFor('sonnet')).toBe('claude-sonnet-4-6');
  });
});

describe('buildSpawnPrompt', () => {
  it('embeds both the system briefing and the task input with the response-contract footer', () => {
    const prompt = buildSpawnPrompt({
      systemPrompt: 'SYS',
      userPrompt: 'USR',
      budget: {
        maxInputTokens: 1,
        maxOutputTokens: 1,
        maxWallClockMs: 1,
        preferredModel: 'sonnet',
        hardCostCeilingUsd: 0
      }
    });
    expect(prompt).toContain('# System briefing');
    expect(prompt).toContain('SYS');
    expect(prompt).toContain('# Task input');
    expect(prompt).toContain('USR');
    expect(prompt).toContain('SINGLE JSON object');
  });
});

describe('createDefaultSpawner', () => {
  it('returns an AuthorSpawnerFn-shaped callable', () => {
    const fn: AuthorSpawnerFn = createDefaultSpawner();
    expect(typeof fn).toBe('function');
  });
});
