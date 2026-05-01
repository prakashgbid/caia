// Claude binary-spawn adapter — spawns the `claude` CLI in --print --output-format=json
// mode and uses the subscription session (Max 20x) for auth.
//
// HARD CONSTRAINT (Prakash 2026-04-30, see feedback_no_api_key_billing.md):
//   The pay-per-token Anthropic API path is FORBIDDEN. We never set
//   ANTHROPIC_API_KEY for the spawned child — we explicitly clear it so the
//   binary falls through to the keychain / OAuth subscription session.
//   If the binary is missing or fails for any reason, we throw — we NEVER
//   fall back to API-key billing.
//
// The router (router.ts) is responsible for the optional fall-through to
// Ollama on `ClaudeBinaryError`. The adapter itself is pure: spawn → parse → return.

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { LLMRequest, LLMResponse } from './types.js';

/** Default path to the `claude` binary. Overridable via env. */
const DEFAULT_CLAUDE_BINARY = process.env['CLAUDE_BINARY_PATH'] ?? 'claude';
/** Default subprocess timeout (ms).
 *
 * Lowered 2026-04-30 from 180_000 to 45_000. The original 3-minute window
 * was sized for the legacy fetch-based adapter where the cost was network
 * RTT + model time. The binary-spawn path adds ~6-10s session-init
 * overhead per call, AND the orchestrator can have many in-flight
 * validation calls; if Claude is unreachable, waiting 3 minutes per call
 * before falling back to Ollama bottlenecks the whole pipeline.
 *
 * 45s covers a normal Sonnet response with margin while keeping fallback
 * latency bounded. Overridable via opts.timeoutMs for callers that
 * deliberately want a longer ceiling (e.g., bulk decomposition).
 */
const DEFAULT_TIMEOUT_MS = 45_000;

/** Generic binary-spawn failure. Thrown for missing binary, non-zero exit,
 *  malformed JSON, or any other non-rate-limit error. */
export class ClaudeBinaryError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly accountId: string | null;

  constructor(opts: {
    message: string;
    stderr?: string;
    exitCode?: number | null;
    accountId?: string | null;
  }) {
    super(opts.message);
    this.name = 'ClaudeBinaryError';
    this.stderr = opts.stderr ?? '';
    this.exitCode = opts.exitCode ?? null;
    this.accountId = opts.accountId ?? null;
  }
}

/** Specialised binary error indicating the subscription account is rate-limited.
 *  Spend-guard's pump-side handler treats this the same way as a
 *  `BudgetExceededError` from `@chiefaia/spend-guard`: pause the pipeline
 *  (or rotate to the next account in the pool, then pause). */
export class ClaudeRateLimitedError extends ClaudeBinaryError {
  constructor(opts: {
    message: string;
    stderr?: string;
    exitCode?: number | null;
    accountId?: string | null;
  }) {
    super(opts);
    this.name = 'ClaudeRateLimitedError';
  }
}

/** Configuration for a single ClaudeAdapter instance. */
export interface ClaudeAdapterOptions {
  /** Override path to the `claude` binary. */
  binaryPath?: string;
  /**
   * Override HOME env var so the spawned binary uses a different
   * credentials dir (~/.config/claude/credentials.json). This is the
   * mechanism for account rotation: account-1 uses ~/.config/claude,
   * account-2 uses some other ~/.caia/accounts/acc-2 with its own
   * `~/.config/claude/credentials.json` symlinked underneath.
   */
  homeOverride?: string;
  /** Optional account id used for telemetry + rate-limit attribution. */
  accountId?: string | null;
  /** Override subprocess timeout. */
  timeoutMs?: number;
  /** Test seam — replace `node:child_process`'s `spawn`. */
  spawnFn?: typeof spawn;
}

/** Shape of the JSON object emitted by `claude --print --output-format json`. */
interface ClaudeBinaryJsonResult {
  type: string;
  subtype?: string;
  is_error?: boolean;
  api_error_status?: number | string | null;
  duration_ms?: number;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; costUSD?: number }>;
}

export class ClaudeAdapter {
  private readonly binaryPath: string;
  private readonly homeOverride: string | null;
  private readonly accountId: string | null;
  private readonly timeoutMs: number;
  private readonly spawnFn: typeof spawn;

  constructor(opts: ClaudeAdapterOptions = {}) {
    this.binaryPath = opts.binaryPath ?? DEFAULT_CLAUDE_BINARY;
    this.homeOverride = opts.homeOverride ?? null;
    this.accountId = opts.accountId ?? null;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.spawnFn = opts.spawnFn ?? spawn;
  }

  /**
   * Generate a completion via the `claude` binary using subscription auth.
   *
   * Throws `ClaudeRateLimitedError` when the spawn output indicates
   * Anthropic returned 429 / quota exhaustion (callers should rotate
   * accounts and/or pause via spend-guard). Throws `ClaudeBinaryError`
   * for any other failure (binary missing, non-zero exit, malformed
   * output, timeout). NEVER falls back to API-key billing.
   */
  async generate(model: string, request: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();

    const args = ['--print', '--output-format', 'json', '--model', model];
    if (request.systemPrompt) {
      args.push('--append-system-prompt', request.systemPrompt);
    }

    // Build env for the child. Clearing ANTHROPIC_API_KEY is the
    // single most important step — it forces the binary to use the
    // OAuth/keychain subscription session instead of pay-per-token.
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    delete env['ANTHROPIC_API_KEY'];
    delete env['ANTHROPIC_AUTH_TOKEN'];
    if (this.homeOverride) env['HOME'] = this.homeOverride;

    const spawnOpts: SpawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    };

    let child: ChildProcess;
    try {
      child = this.spawnFn(this.binaryPath, args, spawnOpts);
    } catch (err) {
      throw new ClaudeBinaryError({
        message: `Failed to spawn '${this.binaryPath}': ${String(err)}`,
        accountId: this.accountId,
      });
    }

    // Send the prompt on stdin.
    const stdin = child.stdin;
    if (!stdin) {
      throw new ClaudeBinaryError({
        message: 'spawned child has no stdin stream',
        accountId: this.accountId,
      });
    }
    stdin.write(request.prompt);
    stdin.end();

    // Collect output with a wall-clock timeout.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }, this.timeoutMs);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const exitCode: number | null = await new Promise((resolve, reject) => {
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new ClaudeBinaryError({
            message: `child process error: ${String(err)}`,
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            accountId: this.accountId,
          }),
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');

    if (timedOut) {
      throw new ClaudeBinaryError({
        message: `claude binary timed out after ${String(this.timeoutMs)}ms`,
        stderr,
        exitCode,
        accountId: this.accountId,
      });
    }

    // Detect rate-limit BEFORE checking exit code — the binary may exit
    // non-zero on rate-limit, and we want the more-specific error class.
    if (looksLikeRateLimit(stdout, stderr, exitCode)) {
      throw new ClaudeRateLimitedError({
        message: 'subscription rate-limited (Anthropic 429 / quota exhausted)',
        stderr,
        exitCode,
        accountId: this.accountId,
      });
    }

    if (exitCode !== 0) {
      throw new ClaudeBinaryError({
        message: `claude binary exited with code ${String(exitCode)}`,
        stderr,
        exitCode,
        accountId: this.accountId,
      });
    }

    let parsed: ClaudeBinaryJsonResult;
    try {
      parsed = JSON.parse(stdout) as ClaudeBinaryJsonResult;
    } catch (err) {
      throw new ClaudeBinaryError({
        message: `failed to parse claude binary stdout as JSON: ${String(err)}`,
        stderr,
        exitCode,
        accountId: this.accountId,
      });
    }

    // The binary signals API errors via is_error + api_error_status — even
    // when exit code is 0. Treat as rate-limit when status looks 429-ish,
    // otherwise generic binary error.
    if (parsed.is_error === true) {
      if (looksLikeRateLimitStatus(parsed.api_error_status)) {
        throw new ClaudeRateLimitedError({
          message: `subscription rate-limited (api_error_status=${String(parsed.api_error_status)})`,
          stderr,
          exitCode,
          accountId: this.accountId,
        });
      }
      throw new ClaudeBinaryError({
        message: `claude binary reported is_error (api_error_status=${String(parsed.api_error_status)})`,
        stderr,
        exitCode,
        accountId: this.accountId,
      });
    }

    const text = typeof parsed.result === 'string' ? parsed.result : '';
    const inputTokens = parsed.usage?.input_tokens ?? 0;
    const outputTokens = parsed.usage?.output_tokens ?? 0;

    return {
      response: text,
      model,
      provider: 'claude',
      durationMs: Date.now() - start,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  }
}

// ─── helpers ───────────────────────────────────────────────────────────

/** Heuristic: stdout/stderr contains rate-limit signal text. */
function looksLikeRateLimit(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): boolean {
  const haystack = (stdout + '\n' + stderr).toLowerCase();
  if (
    haystack.includes('rate limit') ||
    haystack.includes('rate_limit') ||
    haystack.includes('quota exceeded') ||
    haystack.includes('429') ||
    haystack.includes('too many requests')
  ) {
    return true;
  }
  // Some binary builds use exit code 28 for rate-limit (curl convention).
  if (exitCode === 28) return true;
  return false;
}

function looksLikeRateLimitStatus(status: number | string | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  if (typeof status === 'number') return status === 429 || status === 529;
  const s = String(status);
  return s.includes('429') || s.includes('529') || s.toLowerCase().includes('rate');
}
