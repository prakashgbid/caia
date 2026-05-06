import { describe, it, expect } from 'vitest';
import {
  createDefaultLlmClient,
  parseEnvelope,
  extractFirstJsonBlock
} from '../src/llm-client.js';

describe('parseEnvelope', () => {
  it('parses claude --print envelope', () => {
    const stdout = JSON.stringify({ result: 'hello world', cost_usd: 0 });
    const out = parseEnvelope(stdout);
    expect(out.ok).toBe(true);
    expect(out.text).toBe('hello world');
  });
  it('rejects empty stdout', () => {
    expect(parseEnvelope('   ').ok).toBe(false);
  });
  it('rejects non-JSON', () => {
    expect(parseEnvelope('not json').ok).toBe(false);
  });
  it('rejects missing result field', () => {
    expect(parseEnvelope(JSON.stringify({ foo: 'bar' })).ok).toBe(false);
  });
  it('rejects rate-limit envelope (is_error=true exit 0)', () => {
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      api_error_status: 429,
      result: "You've hit your limit · resets 5pm"
    });
    const out = parseEnvelope(stdout);
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('429');
    expect(out.diagnostic).toContain('hit your limit');
  });
});

describe('extractFirstJsonBlock', () => {
  it('extracts from prose-wrapped JSON', () => {
    const input = 'Here is the answer: {"x":1,"y":2} — that is all.';
    expect(extractFirstJsonBlock(input)).toBe('{"x":1,"y":2}');
  });
  it('handles strings with braces', () => {
    const input = '{"msg":"a}b{c","n":3}';
    expect(extractFirstJsonBlock(input)).toBe('{"msg":"a}b{c","n":3}');
  });
  it('returns null when no balanced object', () => {
    expect(extractFirstJsonBlock('no json here')).toBeNull();
    expect(extractFirstJsonBlock('{"unterminated":')).toBeNull();
  });
});

describe('createDefaultLlmClient', () => {
  it('scrubs ANTHROPIC_API_KEY before spawn', async () => {
    let capturedEnv: NodeJS.ProcessEnv | null = null;
    const fakeSpawn = (
      _cmd: string,
      _args: readonly string[],
      sopts: {
        input: string;
        encoding: 'utf-8';
        timeout: number;
        env: NodeJS.ProcessEnv;
        maxBuffer: number;
      }
    ) =>
      ({
        pid: 1,
        output: [null, '', ''],
        stdout: JSON.stringify({ result: 'ok' }),
        stderr: '',
        status: 0,
        signal: null,
        ...((capturedEnv = sopts.env), {})
      } as unknown as ReturnType<typeof import('node:child_process').spawnSync>);
    process.env['ANTHROPIC_API_KEY'] = 'leak-me';
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as Parameters<typeof createDefaultLlmClient>[0]['spawnFn']
    });
    const r = await client.complete({ prompt: 'hi', timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('ok');
    expect(capturedEnv).not.toBeNull();
    expect(capturedEnv?.['ANTHROPIC_API_KEY']).toBeUndefined();
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('returns ok=false on non-zero exit', async () => {
    const fakeSpawn = () =>
      ({
        pid: 1,
        output: [null, '', 'boom'],
        stdout: '',
        stderr: 'boom',
        status: 1,
        signal: null
      } as unknown as ReturnType<typeof import('node:child_process').spawnSync>);
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as Parameters<typeof createDefaultLlmClient>[0]['spawnFn']
    });
    const r = await client.complete({ prompt: 'hi', timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(r.diagnostic).toContain('exited 1');
  });

  it('returns ok=false on rate-limit envelope', async () => {
    const fakeSpawn = () =>
      ({
        pid: 1,
        output: [null, '', ''],
        stdout: JSON.stringify({
          is_error: true,
          api_error_status: 429,
          result: "You've hit your limit · resets 5pm"
        }),
        stderr: '',
        status: 0,
        signal: null
      } as unknown as ReturnType<typeof import('node:child_process').spawnSync>);
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as Parameters<typeof createDefaultLlmClient>[0]['spawnFn']
    });
    const r = await client.complete({ prompt: 'hi', timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(r.diagnostic).toContain('429');
  });

  it('forwards --model flag when provided', async () => {
    let capturedArgs: readonly string[] | null = null;
    const fakeSpawn = (
      _cmd: string,
      args: readonly string[]
    ) => {
      capturedArgs = args;
      return {
        pid: 1,
        output: [null, '', ''],
        stdout: JSON.stringify({ result: 'ok' }),
        stderr: '',
        status: 0,
        signal: null
      } as unknown as ReturnType<typeof import('node:child_process').spawnSync>;
    };
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnFn: fakeSpawn as Parameters<typeof createDefaultLlmClient>[0]['spawnFn']
    });
    await client.complete({
      prompt: 'hi',
      timeoutMs: 1000,
      model: 'claude-sonnet-4-6'
    });
    expect(capturedArgs).toEqual([
      '--print',
      '--output-format',
      'json',
      '--model',
      'claude-sonnet-4-6'
    ]);
  });
});
