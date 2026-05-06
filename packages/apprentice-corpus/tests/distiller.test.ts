import { describe, expect, it, vi } from 'vitest';

import {
  DISTILL_PROMPT_TEMPLATE,
  createDefaultDistiller,
  parseDistillerOutput
} from '../src/distiller.js';

describe('parseDistillerOutput', () => {
  it('parses claude envelope + inner JSON', () => {
    const inner = JSON.stringify({ instruction: 'q', response: 'a' });
    const outer = JSON.stringify({ result: inner });
    expect(parseDistillerOutput(outer)).toEqual({ instruction: 'q', response: 'a' });
  });

  it('throws on malformed envelope', () => {
    expect(() => parseDistillerOutput('not json')).toThrow();
  });

  it('throws when result is not a string', () => {
    expect(() => parseDistillerOutput(JSON.stringify({ result: 123 }))).toThrow();
  });

  it('throws on malformed inner JSON', () => {
    expect(() => parseDistillerOutput(JSON.stringify({ result: 'not-json' }))).toThrow();
  });

  it('throws when inner JSON missing fields', () => {
    expect(() =>
      parseDistillerOutput(JSON.stringify({ result: JSON.stringify({ x: 1 }) }))
    ).toThrow();
  });
});

describe('createDefaultDistiller', () => {
  it('strips ANTHROPIC_API_KEY from spawn env', async () => {
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ result: JSON.stringify({ instruction: 'q', response: 'a' }) }),
      stderr: '',
      error: null
    });
    const distiller = createDefaultDistiller({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as never
    });
    process.env['ANTHROPIC_API_KEY'] = 'should-not-leak';
    await distiller.distill({ source: 'memory', kind: 'directive', text: 'x' });
    const callOpts = fakeSpawn.mock.calls[0]?.[2] as { env: Record<string, string | undefined> };
    expect(callOpts.env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('throws on non-zero exit', async () => {
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'rate limit',
      error: null
    });
    const distiller = createDefaultDistiller({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as never
    });
    await expect(
      distiller.distill({ source: 'memory', text: 'x' })
    ).rejects.toThrow(/exited 1/);
  });

  it('passes prompt as input', async () => {
    const fakeSpawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ result: JSON.stringify({ instruction: 'q', response: 'a' }) }),
      stderr: '',
      error: null
    });
    const distiller = createDefaultDistiller({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as never
    });
    await distiller.distill({ source: 'memory', kind: 'directive', text: 'BODY' });
    const callOpts = fakeSpawn.mock.calls[0]?.[2] as { input: string };
    expect(callOpts.input).toContain('BODY');
    expect(callOpts.input).toContain('memory/directive');
  });
});

describe('DISTILL_PROMPT_TEMPLATE', () => {
  it('contains placeholder slots', () => {
    expect(DISTILL_PROMPT_TEMPLATE).toContain('{source}');
    expect(DISTILL_PROMPT_TEMPLATE).toContain('{kind}');
    expect(DISTILL_PROMPT_TEMPLATE).toContain('{text}');
  });
});
