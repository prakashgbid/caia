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
import type {
  OptimizerInput,
  OptimizerResult,
} from '@chiefaia/prompt-optimizer';
import {
  ClaudeAdapter,
  ClaudeBinaryError,
  ClaudeRateLimitedError,
} from '../src/claude-adapter.js';
import type { OptimizerMetrics } from '../src/types.js';

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

  // ─── LAI phase 6 — prompt-optimizer integration ────────────────────
  describe('prompt-optimizer integration (LAI phase 6)', () => {
    /** Build a fake optimizeFn that returns a scripted compressed prompt. */
    function fakeOptimize(opts: {
      out: string;
      preTokens: number;
      postTokens: number;
      protectedSpans?: number;
      skipped?: boolean;
    }): (input: OptimizerInput) => Promise<OptimizerResult> {
      return async (_input) => ({
        optimizedPrompt: opts.out,
        protectedSpanCount: opts.protectedSpans ?? 0,
        metrics: {
          promptTokensRaw: opts.preTokens,
          stage1: {
            tokensIn: opts.preTokens,
            tokensOut: opts.preTokens,
            wallMs: 0,
            ratio: 1,
            skipped: false,
          },
          stage2: {
            tokensIn: opts.preTokens,
            tokensOut: opts.postTokens,
            wallMs: 0,
            ratio: opts.preTokens > 0 ? opts.postTokens / opts.preTokens : 1,
            skipped: opts.skipped ?? false,
          },
          stage3: {
            tokensIn: opts.postTokens,
            tokensOut: opts.postTokens,
            wallMs: 0,
            ratio: 1,
            skipped: opts.skipped ?? false,
          },
          totalWallMs: 7,
        },
      });
    }

    it('routes the prompt through the optimizer before spawn (compressed body lands on stdin)', async () => {
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        optimizeFn: fakeOptimize({
          out: 'COMPRESSED',
          preTokens: 1000,
          postTokens: 200,
        }),
      });
      await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'the original verbose prompt body with redundant filler text',
      });
      expect(invocations[0]!.stdinChunks.join('')).toBe('COMPRESSED');
    });

    it('emits pre_token_count / post_token_count / compression_ratio on the response', async () => {
      const { fn } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        optimizeFn: fakeOptimize({
          out: 'COMPRESSED',
          preTokens: 1000,
          postTokens: 400,
          protectedSpans: 2,
        }),
      });
      const out = await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'whatever',
      });
      expect(out.optimizer).toBeDefined();
      expect(out.optimizer!.pre_token_count).toBe(1000);
      expect(out.optimizer!.post_token_count).toBe(400);
      expect(out.optimizer!.compression_ratio).toBeCloseTo(0.4, 5);
      expect(out.optimizer!.protected_span_count).toBe(2);
      expect(out.optimizer!.skipped).toBe(false);
    });

    it('forwards optimizer metrics to onOptimizerMetrics sink (OTel/dashboard hook)', async () => {
      const sink = vi.fn();
      const { fn } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        optimizeFn: fakeOptimize({
          out: 'COMPRESSED',
          preTokens: 800,
          postTokens: 320,
        }),
        onOptimizerMetrics: sink,
      });
      await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'x' });
      expect(sink).toHaveBeenCalledTimes(1);
      const m = sink.mock.calls[0]![0] as OptimizerMetrics;
      expect(m.pre_token_count).toBe(800);
      expect(m.post_token_count).toBe(320);
      expect(m.compression_ratio).toBeCloseTo(0.4, 5);
    });

    it('marks skipped=true when both stage2 and stage3 bailed out (short prompt path)', async () => {
      const { fn } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        optimizeFn: fakeOptimize({
          out: 'short prompt',
          preTokens: 50,
          postTokens: 50,
          skipped: true,
        }),
      });
      const out = await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'short prompt',
      });
      expect(out.optimizer?.skipped).toBe(true);
      expect(out.optimizer?.compression_ratio).toBe(1);
    });

    it('degrades gracefully when optimizer throws — sends raw prompt and emits skipped metric', async () => {
      const sink = vi.fn();
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        optimizeFn: async () => {
          throw new Error('optimizer exploded');
        },
        onOptimizerMetrics: sink,
      });
      const out = await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'original verbose body',
      });
      // The raw prompt must reach the binary even when the optimizer fails.
      expect(invocations[0]!.stdinChunks.join('')).toBe('original verbose body');
      expect(out.optimizer?.skipped).toBe(true);
      expect(out.optimizer?.compression_ratio).toBe(1);
      expect(sink).toHaveBeenCalledTimes(1);
    });

    it('honors optimizerDisabled — sends raw prompt unchanged and emits no optimizer field', async () => {
      const sink = vi.fn();
      const optimizeFn = vi.fn(async (_input: OptimizerInput) => {
        throw new Error('optimizer should not be called when disabled');
      });
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        optimizerDisabled: true,
        optimizeFn,
        onOptimizerMetrics: sink,
      });
      const out = await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'untouched body',
      });
      expect(optimizeFn).not.toHaveBeenCalled();
      expect(sink).not.toHaveBeenCalled();
      expect(invocations[0]!.stdinChunks.join('')).toBe('untouched body');
      expect(out.optimizer).toBeUndefined();
    });

    it('does NOT feed systemPrompt to the optimizer (would otherwise duplicate it on stdin)', async () => {
      // Capture the optimizer input so we can assert systemPrompt is omitted.
      let captured: OptimizerInput | null = null;
      const optimizeFn: (input: OptimizerInput) => Promise<OptimizerResult> = async (
        input,
      ) => {
        captured = input;
        return {
          optimizedPrompt: input.userQuestion,
          protectedSpanCount: 0,
          metrics: {
            promptTokensRaw: 10,
            stage1: { tokensIn: 10, tokensOut: 10, wallMs: 0, ratio: 1, skipped: false },
            stage2: { tokensIn: 10, tokensOut: 10, wallMs: 0, ratio: 1, skipped: true },
            stage3: { tokensIn: 10, tokensOut: 10, wallMs: 0, ratio: 1, skipped: true },
            totalWallMs: 1,
          },
        };
      };
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({ spawnFn: fn, optimizeFn });
      await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'the user-side body',
        systemPrompt: 'you are a poet',
      });
      expect(captured).not.toBeNull();
      expect(captured!.systemPrompt).toBeUndefined();
      expect(captured!.userQuestion).toBe('the user-side body');
      // System prompt still goes through the binary's --append-system-prompt flag,
      // not stdin — so stdin only carries the optimized user prompt.
      expect(invocations[0]!.stdinChunks.join('')).toBe('the user-side body');
      expect(invocations[0]!.args).toContain('--append-system-prompt');
      expect(invocations[0]!.args).toContain('you are a poet');
    });
  });
});
