/**
 * Vitest cases for the binary-spawn `ClaudeAdapter`.
 *
 * The adapter spawns the `claude` CLI rather than calling the Anthropic
 * API. To keep the suite hermetic we inject a fake `spawnFn` that returns
 * a minimal `EventEmitter`-based stand-in for `child_process.spawn`'s
 * `ChildProcess`. The fake lets us script stdout, stderr, exit code,
 * and timing per test.
 *
 * HARD CONSTRAINT: assert that the adapter NEVER passes ANTHROPIC_API_KEY
 * through to the spawned child — it must always use subscription auth.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import {
  ClaudeAdapter,
  ClaudeBinaryError,
  ClaudeRateLimitedError,
} from '../src/claude-adapter.js';

// ─── fake child_process.spawn ───────────────────────────────────────────

interface ScriptedCall {
  /** stdout written before exit */
  stdout?: string;
  /** stderr written before exit */
  stderr?: string;
  /** exit code (default 0) */
  code?: number | null;
  /** delay in ms before the close event fires (default 0) */
  delayMs?: number;
  /** if set, emit an `error` event instead of closing */
  errorEvent?: Error;
  /** if set, throw synchronously from spawn (e.g. ENOENT) */
  spawnThrows?: Error;
  /** never close — for timeout tests */
  hang?: boolean;
}

interface SpawnInvocation {
  binary: string;
  args: string[];
  env: Record<string, string | undefined>;
  stdinChunks: string[];
}

function makeFakeSpawn(script: ScriptedCall) {
  const invocations: SpawnInvocation[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn: any = (binary: string, args: string[], opts: { env: Record<string, string> }) => {
    if (script.spawnThrows) throw script.spawnThrows;

    const inv: SpawnInvocation = {
      binary,
      args: [...args],
      env: { ...opts.env },
      stdinChunks: [],
    };
    invocations.push(inv);

    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      stdin: Writable;
      kill: (sig?: string) => void;
    };
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        inv.stdinChunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
        cb();
      },
    });
    child.kill = () => {
      // Simulate kill by emitting close with non-zero code (only if not yet closed).
      setImmediate(() => {
        child.stdout.push(null);
        child.stderr.push(null);
        child.emit('close', 143);
      });
    };

    if (script.hang) {
      // Never push terminal — the test will rely on the adapter's own timeout.
      return child;
    }

    const finishMs = script.delayMs ?? 0;
    setTimeout(() => {
      if (script.stdout) child.stdout.push(script.stdout);
      child.stdout.push(null);
      if (script.stderr) child.stderr.push(script.stderr);
      child.stderr.push(null);
      if (script.errorEvent) {
        child.emit('error', script.errorEvent);
        return;
      }
      child.emit('close', script.code ?? 0);
    }, finishMs);

    return child;
  };
  return { fn, invocations };
}

const HAPPY_PATH_JSON = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  api_error_status: null,
  result: 'hi back',
  total_cost_usd: 0.001,
  usage: { input_tokens: 5, output_tokens: 3 },
  modelUsage: { 'claude-sonnet-4-6': { inputTokens: 5, outputTokens: 3, costUSD: 0.001 } },
});

// ─── tests ───────────────────────────────────────────────────────────────

describe('ClaudeAdapter (binary spawn)', () => {
  it('happy path — parses JSON output and reports subscription provider', async () => {
    const { fn } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
    const adapter = new ClaudeAdapter({ spawnFn: fn });
    const out = await adapter.generate('claude-sonnet-4-6', {
      taskType: 'hierarchy-decomposition',
      prompt: 'hi',
    });
    expect(out.provider).toBe('claude');
    expect(out.response).toBe('hi back');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.usage?.totalTokens).toBe(8);
  });

  it('passes --model + --print + --output-format json to the binary', async () => {
    const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
    const adapter = new ClaudeAdapter({ spawnFn: fn });
    await adapter.generate('claude-haiku-4-5', { taskType: 't', prompt: 'p' });
    const args = invocations[0]!.args;
    expect(args).toContain('--print');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('--model');
    expect(args).toContain('claude-haiku-4-5');
  });

  it('writes the prompt to the binary stdin', async () => {
    const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
    const adapter = new ClaudeAdapter({ spawnFn: fn });
    await adapter.generate('claude-sonnet-4-6', {
      taskType: 't',
      prompt: 'the literal prompt body',
    });
    expect(invocations[0]!.stdinChunks.join('')).toBe('the literal prompt body');
  });

  it('NEVER forwards ANTHROPIC_API_KEY to the child env (subscription only)', async () => {
    const prev = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-LEAKED-KEY-MUST-NOT-PASS';
    try {
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({ spawnFn: fn });
      await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' });
      expect(invocations[0]!.env['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(invocations[0]!.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env['ANTHROPIC_API_KEY'] = prev;
      else delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  it('honors homeOverride for account rotation (HOME → per-account creds dir)', async () => {
    const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
    const adapter = new ClaudeAdapter({
      spawnFn: fn,
      homeOverride: '/Users/MAC/.caia/accounts/acc-2',
      accountId: 'acc-2',
    });
    await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' });
    expect(invocations[0]!.env['HOME']).toBe('/Users/MAC/.caia/accounts/acc-2');
  });

  it('detects rate-limit via stderr text and throws ClaudeRateLimitedError', async () => {
    const { fn } = makeFakeSpawn({
      stdout: '',
      stderr: 'Error: 429 Too Many Requests — rate_limit_exceeded',
      code: 1,
    });
    const adapter = new ClaudeAdapter({ spawnFn: fn, accountId: 'acc-1' });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toBeInstanceOf(ClaudeRateLimitedError);
  });

  it('detects rate-limit via api_error_status=429 in JSON result', async () => {
    const json = JSON.stringify({
      type: 'result',
      is_error: true,
      api_error_status: 429,
      result: '',
    });
    const { fn } = makeFakeSpawn({ stdout: json });
    const adapter = new ClaudeAdapter({ spawnFn: fn, accountId: 'acc-1' });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toBeInstanceOf(ClaudeRateLimitedError);
  });

  it('reports accountId on ClaudeRateLimitedError for pool rotation', async () => {
    const { fn } = makeFakeSpawn({
      stdout: '',
      stderr: '429 rate limit hit',
      code: 1,
    });
    const adapter = new ClaudeAdapter({ spawnFn: fn, accountId: 'acc-7' });
    try {
      await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClaudeRateLimitedError);
      expect((err as ClaudeRateLimitedError).accountId).toBe('acc-7');
    }
  });

  it('throws ClaudeBinaryError when the binary is missing (spawn ENOENT)', async () => {
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const { fn } = makeFakeSpawn({ spawnThrows: enoent });
    const adapter = new ClaudeAdapter({ spawnFn: fn, binaryPath: 'claude' });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toBeInstanceOf(ClaudeBinaryError);
  });

  it('throws ClaudeBinaryError when the binary exits non-zero with no rate-limit signal', async () => {
    const { fn } = makeFakeSpawn({ stdout: '', stderr: 'unknown error', code: 2 });
    const adapter = new ClaudeAdapter({ spawnFn: fn });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toBeInstanceOf(ClaudeBinaryError);
  });

  it('throws ClaudeBinaryError when stdout is malformed JSON', async () => {
    const { fn } = makeFakeSpawn({ stdout: 'definitely not json{{{', code: 0 });
    const adapter = new ClaudeAdapter({ spawnFn: fn });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toThrow(/parse claude binary stdout/);
  });

  it('throws ClaudeBinaryError on timeout (kills the child)', async () => {
    const { fn } = makeFakeSpawn({ hang: true });
    const adapter = new ClaudeAdapter({ spawnFn: fn, timeoutMs: 25 });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toThrow(/timed out/);
  });

  it('throws ClaudeBinaryError when the child emits an error event', async () => {
    const { fn } = makeFakeSpawn({ errorEvent: new Error('pipe broken') });
    const adapter = new ClaudeAdapter({ spawnFn: fn });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toBeInstanceOf(ClaudeBinaryError);
  });

  it('does NOT fall back to API-key path when binary fails (must be handled by router/spend-guard)', async () => {
    // The adapter itself should ALWAYS throw. Router-level fallback to
    // Ollama is acceptable; API-key fallback is forbidden per Prakash
    // 2026-04-30 rule. This test asserts the adapter never silently
    // returns a non-binary response.
    const { fn } = makeFakeSpawn({ stdout: '', stderr: 'binary blew up', code: 99 });
    const adapter = new ClaudeAdapter({ spawnFn: fn });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toBeInstanceOf(ClaudeBinaryError);
    // The spawned binary path must not have triggered any HTTP call.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('passes --append-system-prompt when systemPrompt is provided', async () => {
    const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
    const adapter = new ClaudeAdapter({ spawnFn: fn });
    await adapter.generate('claude-sonnet-4-6', {
      taskType: 't',
      prompt: 'user',
      systemPrompt: 'you are a poet',
    });
    const args = invocations[0]!.args;
    expect(args).toContain('--append-system-prompt');
    expect(args).toContain('you are a poet');
  });

  it('reports usage tokens from the binary JSON output', async () => {
    const json = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'ok',
      usage: { input_tokens: 100, output_tokens: 250 },
    });
    const { fn } = makeFakeSpawn({ stdout: json });
    const adapter = new ClaudeAdapter({ spawnFn: fn });
    const out = await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' });
    expect(out.usage).toEqual({
      promptTokens: 100,
      completionTokens: 250,
      totalTokens: 350,
    });
  });
});
