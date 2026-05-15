/**
 * Vitest cases for the binary-spawn `ClaudeAdapter`.
 *
 * The adapter spawns the `claude` CLI rather than calling the Anthropic
 * API. To keep the suite hermetic we inject a fake `spawnFn` that returns
 * a minimal `EventEmitter`-based stand-in for `child_process.spawn`'s
 * `ChildProcess`. The fake lets us script stdout, stderr, exit code,
 * and timing per test.
 *
 * The compression pipeline (Stage 1 prepass + Headroom sidecar) is
 * stubbed in two ways:
 *   - For tests that don't care about compression, we pass
 *     `optimizerDisabled: true` so the raw prompt goes straight to the
 *     binary and the only spawn call is the `claude` binary.
 *   - For tests that DO assert on compression behavior, we pass
 *     `sidecarFn` to return a scripted Headroom response without
 *     spawning a Python subprocess.
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
  type HeadroomSidecarRequest,
  type HeadroomSidecarResponse,
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

/** Identity sidecar — returns the messages unchanged, zero compression.
 *  Used by tests that need the pipeline enabled but don't care about
 *  Headroom's transforms. */
const identitySidecar = async (
  req: HeadroomSidecarRequest,
): Promise<HeadroomSidecarResponse> => {
  const joined = req.messages.map((m) => m.content).join('\n\n');
  const tokens = Math.ceil(joined.length / 4);
  return {
    compressed_messages: req.messages,
    tokens_saved: 0,
    compression_ratio: 0,
    original_tokens: tokens,
    final_tokens: tokens,
    transforms_applied: [],
  };
};

// ─── tests ───────────────────────────────────────────────────────────────

describe('ClaudeAdapter (binary spawn)', () => {
  it('happy path — parses JSON output and reports subscription provider', async () => {
    const { fn } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
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
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
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
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
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
      const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
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
      optimizerDisabled: true,
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
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true, accountId: 'acc-1' });
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
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true, accountId: 'acc-1' });
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
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true, accountId: 'acc-7' });
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
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true, binaryPath: 'claude' });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toBeInstanceOf(ClaudeBinaryError);
  });

  it('throws ClaudeBinaryError when the binary exits non-zero with no rate-limit signal', async () => {
    const { fn } = makeFakeSpawn({ stdout: '', stderr: 'unknown error', code: 2 });
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toBeInstanceOf(ClaudeBinaryError);
  });

  it('throws ClaudeBinaryError when stdout is malformed JSON', async () => {
    const { fn } = makeFakeSpawn({ stdout: 'definitely not json{{{', code: 0 });
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toThrow(/parse claude binary stdout/);
  });

  it('throws ClaudeBinaryError on timeout (kills the child)', async () => {
    const { fn } = makeFakeSpawn({ hang: true });
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true, timeoutMs: 25 });
    await expect(
      adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
    ).rejects.toThrow(/timed out/);
  });

  it('throws ClaudeBinaryError when the child emits an error event', async () => {
    const { fn } = makeFakeSpawn({ errorEvent: new Error('pipe broken') });
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
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
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
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
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
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
    const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
    const out = await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' });
    expect(out.usage).toEqual({
      promptTokens: 100,
      completionTokens: 250,
      totalTokens: 350,
    });
  });

  // ─── LAI phase 2 — Stage 1 + Headroom sidecar integration ──────────
  describe('compression pipeline (Stage 1 + Headroom sidecar)', () => {
    /** Build a sidecar mock that returns the supplied compressed text and
     *  reports a fixed savings. */
    function fakeSidecar(opts: {
      compressedContent: string;
      originalTokens: number;
      finalTokens: number;
      transforms?: string[];
    }): (req: HeadroomSidecarRequest) => Promise<HeadroomSidecarResponse> {
      return async (req) => {
        const saved = Math.max(0, opts.originalTokens - opts.finalTokens);
        const ratio =
          opts.originalTokens > 0 ? saved / opts.originalTokens : 0;
        return {
          compressed_messages: [
            { ...req.messages[0]!, content: opts.compressedContent },
          ],
          tokens_saved: saved,
          compression_ratio: ratio,
          original_tokens: opts.originalTokens,
          final_tokens: opts.finalTokens,
          transforms_applied: opts.transforms ?? ['router:smart_crusher:0.00'],
        };
      };
    }

    it('routes the prompt through the sidecar before spawn (compressed body lands on stdin)', async () => {
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        sidecarFn: fakeSidecar({
          compressedContent: 'COMPRESSED',
          originalTokens: 1000,
          finalTokens: 200,
        }),
      });
      await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'the original verbose prompt body with redundant filler text',
      });
      // Only one spawn (claude binary). Sidecar was injected, not spawned.
      expect(invocations).toHaveLength(1);
      expect(invocations[0]!.stdinChunks.join('')).toBe('COMPRESSED');
    });

    it('emits pre/post token counts and headroom_tokens_saved / headroom_ratio', async () => {
      const { fn } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const sink = vi.fn();
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        sidecarFn: fakeSidecar({
          compressedContent: 'COMPRESSED',
          originalTokens: 1000,
          finalTokens: 300,
        }),
        onOptimizerMetrics: sink,
      });
      const out = await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'whatever the prompt is, the stage 1 pass plus headroom owns it',
      });
      expect(out.optimizer).toBeDefined();
      expect(out.optimizer!.skipped).toBe(false);
      expect(out.optimizer!.headroom_tokens_saved).toBe(700);
      expect(out.optimizer!.headroom_ratio).toBeCloseTo(0.7, 5);
      expect(out.optimizer!.post_token_count).toBe(300);
      // The sink received the same metrics.
      expect(sink).toHaveBeenCalledTimes(1);
      const m = sink.mock.calls[0]![0] as OptimizerMetrics;
      expect(m.headroom_tokens_saved).toBe(700);
      expect(m.headroom_ratio).toBeCloseTo(0.7, 5);
    });

    it('passes the user prompt (post-Stage-1) to the sidecar as a single user message', async () => {
      const { fn } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      let captured: HeadroomSidecarRequest | null = null;
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        sidecarFn: async (req) => {
          captured = req;
          return identitySidecar(req);
        },
      });
      await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'a short prompt',
        systemPrompt: 'you are a poet',
      });
      expect(captured).not.toBeNull();
      expect(captured!.messages).toHaveLength(1);
      expect(captured!.messages[0]!.role).toBe('user');
      // System prompt must NOT be folded into the sidecar input — it's
      // forwarded separately via --append-system-prompt.
      expect(captured!.messages[0]!.content).not.toContain('you are a poet');
    });

    it('degrades to Stage-1-only output when the sidecar throws', async () => {
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const sink = vi.fn();
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        sidecarFn: async () => {
          throw new Error('sidecar exploded');
        },
        onOptimizerMetrics: sink,
      });
      const out = await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'original verbose body',
      });
      // Stage 1 produces the same body for trivial input — the raw
      // prompt still reaches the binary.
      expect(invocations[0]!.stdinChunks.join('')).toBe('original verbose body');
      expect(out.optimizer?.skipped).toBe(true);
      expect(out.optimizer?.headroom_tokens_saved).toBe(0);
      expect(out.optimizer?.headroom_ratio).toBe(0);
      expect(sink).toHaveBeenCalledTimes(1);
    });

    it('honors optimizerDisabled — sends raw prompt and emits no optimizer field', async () => {
      const sink = vi.fn();
      const sidecarFn = vi.fn(async (_req: HeadroomSidecarRequest) => {
        throw new Error('sidecar must not be called when optimizer is disabled');
      });
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        optimizerDisabled: true,
        sidecarFn,
        onOptimizerMetrics: sink,
      });
      const out = await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'untouched body',
      });
      expect(sidecarFn).not.toHaveBeenCalled();
      expect(sink).not.toHaveBeenCalled();
      expect(invocations[0]!.stdinChunks.join('')).toBe('untouched body');
      expect(out.optimizer).toBeUndefined();
    });

    it('forwards systemPrompt via --append-system-prompt, NOT through the sidecar', async () => {
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({
        spawnFn: fn,
        sidecarFn: identitySidecar,
      });
      await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'the user-side body',
        systemPrompt: 'you are a poet',
      });
      const args = invocations[0]!.args;
      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('you are a poet');
      // The system prompt must not be duplicated on stdin.
      expect(invocations[0]!.stdinChunks.join('')).toBe('the user-side body');
    });

    it('rebuilds the final prompt by concatenating compressed_messages content', async () => {
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      // Sidecar returns multiple compressed messages (e.g. Headroom
      // injected a synopsis turn). The adapter must concat them.
      const sidecarFn = async (
        _req: HeadroomSidecarRequest,
      ): Promise<HeadroomSidecarResponse> => ({
        compressed_messages: [
          { role: 'assistant', content: 'PRIOR_SUMMARY' },
          { role: 'user', content: 'COMPRESSED_USER_BODY' },
        ],
        tokens_saved: 500,
        compression_ratio: 0.5,
        original_tokens: 1000,
        final_tokens: 500,
        transforms_applied: ['router:summarize'],
      });
      const adapter = new ClaudeAdapter({ spawnFn: fn, sidecarFn });
      await adapter.generate('claude-sonnet-4-6', {
        taskType: 't',
        prompt: 'a verbose original body',
      });
      expect(invocations[0]!.stdinChunks.join('')).toBe(
        'PRIOR_SUMMARY\n\nCOMPRESSED_USER_BODY',
      );
    });
  });

  // ─── A.9.5 — per-hour Claude-call budget guard ───────────────────────
  describe('A.9.5 — claude per-hour budget guard', () => {
    it('rejects the (cap+1)th call with ClaudeBudgetExceededError BEFORE spawning the binary', async () => {
      const { ClaudeCallBudget } = await import('../src/claude-call-budget.js');
      const { ClaudeBudgetExceededError } = await import('../src/claude-adapter.js');
      const budget = new ClaudeCallBudget({ cap: 1 });
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true, budget });

      // 1st call: ok
      await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' });
      expect(invocations.length).toBe(1);

      // 2nd call: rejected, no spawn
      await expect(
        adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' }),
      ).rejects.toBeInstanceOf(ClaudeBudgetExceededError);
      expect(invocations.length).toBe(1);
    });

    it('disabled budget (cap=0) never rejects', async () => {
      const { ClaudeCallBudget } = await import('../src/claude-call-budget.js');
      const budget = new ClaudeCallBudget({ cap: 0 });
      const { fn, invocations } = makeFakeSpawn({ stdout: HAPPY_PATH_JSON });
      const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true, budget });
      for (let i = 0; i < 5; i++) {
        await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' });
      }
      expect(invocations.length).toBe(5);
    });
  });

  // ─── A.9.9 — output-side caveman compression ────────────────────────
  describe('A.9.9 — output-side caveman compression', () => {
    const VERBOSE_RESPONSE_JSON = JSON.stringify({
      type: 'result',
      is_error: false,
      result:
        "Here's the answer you asked for:\n\nThe fix is at line 42.\n\nLet me know if you need anything else!",
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    it('strips the preamble + recap from the response by default', async () => {
      const { fn } = makeFakeSpawn({ stdout: VERBOSE_RESPONSE_JSON });
      const adapter = new ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
      const out = await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' });
      expect(out.response).toBe('The fix is at line 42.');
    });

    it('passes the response through unchanged when CAVEMAN_COMPRESS_OUTPUT_DISABLE=1', async () => {
      const orig = process.env['CAVEMAN_COMPRESS_OUTPUT_DISABLE'];
      process.env['CAVEMAN_COMPRESS_OUTPUT_DISABLE'] = '1';
      // Need fresh module so the singleton picks up env.
      vi.resetModules();
      try {
        const mod = await import('../src/claude-adapter.js');
        const { fn } = makeFakeSpawn({ stdout: VERBOSE_RESPONSE_JSON });
        const adapter = new mod.ClaudeAdapter({ spawnFn: fn, optimizerDisabled: true });
        const out = await adapter.generate('claude-sonnet-4-6', { taskType: 't', prompt: 'p' });
        expect(out.response).toContain("Here's the answer");
        expect(out.response).toContain('Let me know');
      } finally {
        if (orig === undefined) delete process.env['CAVEMAN_COMPRESS_OUTPUT_DISABLE'];
        else process.env['CAVEMAN_COMPRESS_OUTPUT_DISABLE'] = orig;
        vi.resetModules();
      }
    });
  });
});
