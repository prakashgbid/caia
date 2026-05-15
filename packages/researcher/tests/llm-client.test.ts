import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { spawn as nodeSpawn } from 'node:child_process';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDefaultLlmClient,
  parseEnvelope,
  extractFirstJsonBlock
} from '../src/llm-client.js';

/** Fake-child compatible with `@chiefaia/claude-spawner`'s spawn seam. */
function makeFakeSpawnFn(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  errorBeforeClose?: Error;
  argsSpy?: (args: readonly string[]) => void;
  envSpy?: (env: NodeJS.ProcessEnv) => void;
  onSpawn?: () => void;
}): typeof nodeSpawn {
  return ((
    _cmd: string,
    args: readonly string[],
    spawnOpts?: { env?: NodeJS.ProcessEnv },
  ): unknown => {
    opts.onSpawn?.();
    opts.argsSpy?.(args);
    if (spawnOpts?.env !== undefined) opts.envSpy?.(spawnOpts.env);
    const ee = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: Readable;
      stderr: Readable;
      kill: () => boolean;
    };
    ee.stdin = new Writable({ write(_c, _e, cb): void { cb(); } });
    ee.stdout = new Readable({ read(): void {} });
    ee.stderr = new Readable({ read(): void {} });
    ee.kill = (): boolean => true;
    setImmediate(() => {
      if (opts.stdout !== undefined) ee.stdout.emit('data', Buffer.from(opts.stdout, 'utf8'));
      if (opts.stderr !== undefined) ee.stderr.emit('data', Buffer.from(opts.stderr, 'utf8'));
      if (opts.errorBeforeClose !== undefined) ee.emit('error', opts.errorBeforeClose);
      else ee.emit('close', opts.exitCode ?? 0);
    });
    return ee;
  }) as unknown as typeof nodeSpawn;
}

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
    const fakeSpawn = makeFakeSpawnFn({
      stdout: JSON.stringify({ result: 'ok' }),
      exitCode: 0,
      envSpy: (env) => { capturedEnv = env; }
    });
    process.env['ANTHROPIC_API_KEY'] = 'leak-me';
    try {
      const client = createDefaultLlmClient({
        binaryPath: 'claude',
        spawnImpl: fakeSpawn
      });
      const r = await client.complete({ prompt: 'hi', timeoutMs: 1000 });
      expect(r.ok).toBe(true);
      expect(r.text).toBe('ok');
      expect(capturedEnv).not.toBeNull();
      expect(capturedEnv?.['ANTHROPIC_API_KEY']).toBeUndefined();
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  it('returns ok=false on non-zero exit', async () => {
    const fakeSpawn = makeFakeSpawnFn({ stderr: 'boom', exitCode: 1 });
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnImpl: fakeSpawn
    });
    const r = await client.complete({ prompt: 'hi', timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(r.diagnostic).toContain('exited 1');
  });

  it('returns ok=false on rate-limit envelope', async () => {
    const fakeSpawn = makeFakeSpawnFn({
      stdout: JSON.stringify({
        is_error: true,
        api_error_status: 429,
        result: "You've hit your limit · resets 5pm"
      }),
      exitCode: 0
    });
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnImpl: fakeSpawn
    });
    const r = await client.complete({ prompt: 'hi', timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(r.diagnostic).toContain('429');
  });

  it('forwards --model flag when provided', async () => {
    let capturedArgs: readonly string[] | null = null;
    const fakeSpawn = makeFakeSpawnFn({
      stdout: JSON.stringify({ result: 'ok' }),
      exitCode: 0,
      argsSpy: (args) => { capturedArgs = args; }
    });
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnImpl: fakeSpawn
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

describe('A.9.13 — small-payload local-router shortcut (researcher)', () => {
  beforeEach(() => {
    delete process.env['CAIA_REVIEW_LOCAL_FIRST'];
    delete process.env['CAIA_RESEARCH_LOCAL_BYTES_MAX'];
    delete process.env['CAIA_RESEARCH_LOCAL_MODEL'];
    delete process.env['CAIA_RESEARCH_LOCAL_TIMEOUT_MS'];
    delete process.env['ROUTER_BASE_URL'];
    vi.unstubAllGlobals();
  });

  it('default: env unset → does not call the router', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const fakeSpawn = makeFakeSpawnFn({
      stdout: JSON.stringify({ result: 'ok' }),
      exitCode: 0,
      onSpawn: () => { spawned = true; }
    });
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnImpl: fakeSpawn
    });
    const r = await client.complete({ prompt: 'small q', timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spawned).toBe(true);
  });

  it('routes small prompt to the router when env flag is on', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'local synth result' } }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const fakeSpawn = makeFakeSpawnFn({
      stdout: '',
      exitCode: 0,
      onSpawn: () => { spawned = true; }
    });
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnImpl: fakeSpawn
    });
    const r = await client.complete({ prompt: 'tiny', timeoutMs: 1000 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(spawned).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.text).toBe('local synth result');
  });

  it('falls through to claude on large payload', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    process.env['CAIA_RESEARCH_LOCAL_BYTES_MAX'] = '10';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const fakeSpawn = makeFakeSpawnFn({
      stdout: JSON.stringify({ result: 'claude' }),
      exitCode: 0,
      onSpawn: () => { spawned = true; }
    });
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnImpl: fakeSpawn
    });
    await client.complete({ prompt: 'this prompt is more than 10 bytes', timeoutMs: 1000 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spawned).toBe(true);
  });

  it('falls through to claude on router failure', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const fakeSpawn = makeFakeSpawnFn({
      stdout: JSON.stringify({ result: 'claude-fallback' }),
      exitCode: 0,
      onSpawn: () => { spawned = true; }
    });
    const client = createDefaultLlmClient({
      binaryPath: 'claude',
      spawnImpl: fakeSpawn
    });
    const r = await client.complete({ prompt: 'small', timeoutMs: 1000 });
    expect(fetchSpy).toHaveBeenCalled();
    expect(spawned).toBe(true);
    expect(r.text).toBe('claude-fallback');
  });
});
