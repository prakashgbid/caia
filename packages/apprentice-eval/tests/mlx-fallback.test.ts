import { describe, expect, it } from 'vitest';

import { __TEST_ONLY } from '../src/mlx-fallback.js';

describe('buildSafeEnv', () => {
  it('strips known LLM secrets', () => {
    const env = {
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'should-be-removed',
      OPENAI_API_KEY: 'also-removed',
      HOME: '/home'
    };
    const safe = __TEST_ONLY.buildSafeEnv(env);
    expect(safe['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(safe['OPENAI_API_KEY']).toBeUndefined();
    expect(safe['PATH']).toBe('/usr/bin');
    expect(safe['HOME']).toBe('/home');
  });

  it('returns a NEW object (does not mutate input)', () => {
    const env = { ANTHROPIC_API_KEY: 'x' };
    const safe = __TEST_ONLY.buildSafeEnv(env);
    expect(env['ANTHROPIC_API_KEY']).toBe('x');
    expect(safe['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('covers every defined secret name', () => {
    const env: Record<string, string> = {};
    for (const k of __TEST_ONLY.SECRETS_TO_SCRUB) env[k] = 'leak';
    const safe = __TEST_ONLY.buildSafeEnv(env);
    for (const k of __TEST_ONLY.SECRETS_TO_SCRUB) expect(safe[k]).toBeUndefined();
  });
});
