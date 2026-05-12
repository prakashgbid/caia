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
//
// ─── Prompt compression pipeline (LAI phase 2 — Headroom integration) ───
// Each request runs through a two-step compression pipeline before the
// prompt reaches the `claude` binary:
//
//   1. Stage 1 (`stage1Prepass`) — rule-based prepass from
//      @chiefaia/prompt-optimizer. Strips ANSI/CRLF/BOM, dedupes blocks,
//      folds long file reads, normalizes JSON, etc. Cheap and deterministic.
//
//   2. Headroom sidecar — spawns a Python subprocess that calls
//      headroom.compress(). Headroom owns the heavy lifting: SmartCrusher
//      for JSON blobs, CodeCompressor for AST-aware code dedup, Kompress
//      (ModernBERT) for prose summarization. Stage 1 is kept because
//      Headroom's router protects user turns (it won't dedupe within them),
//      so our rule prepass handles the in-turn duplication while Headroom
//      handles tool-result/system content.
//
// The two stages are complementary, not redundant. If the sidecar fails for
// any reason (subprocess error, malformed JSON, timeout), we degrade to
// Stage-1-only output and emit a `skipped: true` metric — the prompt still
// goes through; only the savings are reduced.

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { join, dirname } from 'node:path';
import { stage1Prepass, estimateTokens } from '@chiefaia/prompt-optimizer';
import type {
  LLMRequest,
  LLMResponse,
  OptimizerMetrics as RouterOptimizerMetrics,
} from './types.js';

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

/** Default Python interpreter that has `headroom-ai` installed.
 *
 * Phase 1 (install_headroom_on_m3) reports headroom is wheeled against
 * CPython 3.13; the system `python3` is 3.14 which PyO3 does not yet
 * support. We pin the absolute path so the sidecar always finds the right
 * interpreter regardless of $PATH ordering. Override via env or opts. */
const DEFAULT_HEADROOM_PYTHON =
  process.env['HEADROOM_PYTHON'] ?? '/opt/homebrew/opt/python@3.13/bin/python3.13';

/** Default headroom sidecar path — resolved from the compiled file's
 *  location at runtime. After build, `__dirname` is `<pkg>/dist`; the
 *  sidecar lives at `<pkg>/python/headroom_sidecar.py`. */
const DEFAULT_HEADROOM_SIDECAR = join(dirname(__filename), '..', 'python', 'headroom_sidecar.py');

/** Default Headroom sidecar timeout (ms).
 *
 * Cold start dominates: Headroom's Kompress backend lazy-loads a
 * ModernBERT model on first call, which on M3 takes ~20-25s. After warm,
 * compression itself is sub-second. 60s gives the first call comfortable
 * room without unbounded ceilings; subsequent calls finish well under it.
 * If the sidecar hangs the adapter falls back to Stage-1-only output. */
const DEFAULT_HEADROOM_TIMEOUT_MS = 60_000;

/** Default target model passed to `headroom.compress(..., model=)`. Headroom
 *  uses this for token estimation and per-model heuristics. */
const DEFAULT_HEADROOM_MODEL = 'claude-sonnet-4-5-20250929';

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

// ─── Headroom sidecar protocol ─────────────────────────────────────────

export interface HeadroomMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

export interface HeadroomSidecarRequest {
  messages: HeadroomMessage[];
  model: string;
}

export interface HeadroomSidecarResponse {
  compressed_messages: HeadroomMessage[];
  tokens_saved: number;
  compression_ratio: number;
  original_tokens: number;
  final_tokens: number;
  transforms_applied?: string[];
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
  /**
   * Disable the compression pipeline entirely (Stage 1 + Headroom). The
   * raw prompt is passed straight through to the binary. Use for adapters
   * that already received an optimized prompt upstream (e.g. the spawner)
   * or in tests that assert on the exact byte content of stdin.
   */
  optimizerDisabled?: boolean;
  /**
   * Optional sink for compression metrics. Called after each compression
   * pass, before the prompt is sent to the binary. Use to forward to
   * OTel / llm-metrics. Defaults to a no-op.
   */
  onOptimizerMetrics?: (metrics: RouterOptimizerMetrics) => void;
  /**
   * Absolute path to the Python interpreter that has `headroom-ai`
   * installed. Defaults to env var HEADROOM_PYTHON, then to
   * `/opt/homebrew/opt/python@3.13/bin/python3.13` (the path the LAI
   * Phase 1 install report points at).
   */
  headroomPython?: string;
  /** Absolute path to the headroom_sidecar.py script. */
  headroomSidecarPath?: string;
  /** Override sidecar subprocess timeout (ms). */
  headroomTimeoutMs?: number;
  /** Override the Headroom-side target model used for token estimation. */
  headroomModel?: string;
  /**
   * Test seam — replace the sidecar invocation. When provided, the
   * adapter skips spawning a subprocess and calls this function directly.
   * Used by the unit tests to inject scripted compression results.
   */
  sidecarFn?: (
    req: HeadroomSidecarRequest,
  ) => Promise<HeadroomSidecarResponse>;
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
  private readonly optimizerDisabled: boolean;
  private readonly onOptimizerMetrics:
    | ((metrics: RouterOptimizerMetrics) => void)
    | null;
  private readonly headroomPython: string;
  private readonly headroomSidecarPath: string;
  private readonly headroomTimeoutMs: number;
  private readonly headroomModel: string;
  private readonly sidecarFn:
    | ((req: HeadroomSidecarRequest) => Promise<HeadroomSidecarResponse>)
    | null;

  constructor(opts: ClaudeAdapterOptions = {}) {
    this.binaryPath = opts.binaryPath ?? DEFAULT_CLAUDE_BINARY;
    this.homeOverride = opts.homeOverride ?? null;
    this.accountId = opts.accountId ?? null;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.spawnFn = opts.spawnFn ?? spawn;
    this.optimizerDisabled = opts.optimizerDisabled ?? false;
    this.onOptimizerMetrics = opts.onOptimizerMetrics ?? null;
    this.headroomPython = opts.headroomPython ?? DEFAULT_HEADROOM_PYTHON;
    this.headroomSidecarPath = opts.headroomSidecarPath ?? DEFAULT_HEADROOM_SIDECAR;
    this.headroomTimeoutMs = opts.headroomTimeoutMs ?? DEFAULT_HEADROOM_TIMEOUT_MS;
    this.headroomModel = opts.headroomModel ?? DEFAULT_HEADROOM_MODEL;
    this.sidecarFn = opts.sidecarFn ?? null;
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

    // Run Stage 1 prepass + Headroom sidecar. Failure-mode for the
    // compression pipeline is best-effort: any error inside degrades to
    // a less-compressed prompt and a skipped metric, never throws.
    const { promptForBinary, optimizerMetrics } = await this.optimizePrompt(
      request,
    );

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
    stdin.write(promptForBinary);
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

    const resp: LLMResponse = {
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
    if (optimizerMetrics) resp.optimizer = optimizerMetrics;
    return resp;
  }

  /**
   * Run the request prompt through Stage 1 prepass + Headroom sidecar.
   * Returns the prompt to feed the binary and the metrics to emit.
   *
   * Failure mode: best-effort. If Stage 1 throws or Headroom misbehaves
   * we fall back to the most-compressed prompt we have so far (raw, or
   * Stage-1 output) and emit a `skipped: true` metric so the dashboard
   * still observes the call.
   */
  private async optimizePrompt(request: LLMRequest): Promise<{
    promptForBinary: string;
    optimizerMetrics: RouterOptimizerMetrics | null;
  }> {
    if (this.optimizerDisabled) {
      return { promptForBinary: request.prompt, optimizerMetrics: null };
    }

    const wallStart = Date.now();
    const rawPrompt = request.prompt;
    const preTokens = estimateTokens(rawPrompt);

    // ─── Stage 1: rule-based prepass ──────────────────────────────────
    // Cheap, deterministic. We keep it even though Headroom exists
    // because Headroom's router protects user-role turns from
    // compression by default, so any in-turn duplication (dedupe of
    // repeated blocks, ANSI stripping, long file-read folding, base64
    // truncation) has to happen before Headroom sees the messages.
    let stage1Text: string;
    let protectedSpans: number;
    try {
      const r = stage1Prepass(rawPrompt);
      stage1Text = r.text;
      protectedSpans = r.protectedSpans;
    } catch {
      // Prepass blew up — degrade to raw prompt for Stage 1, still try Headroom.
      stage1Text = rawPrompt;
      protectedSpans = 0;
    }

    // ─── Stage 2: Headroom sidecar ────────────────────────────────────
    const messages: HeadroomMessage[] = [{ role: 'user', content: stage1Text }];

    let sidecarOut: HeadroomSidecarResponse | null = null;
    try {
      sidecarOut = await this.invokeSidecar({
        messages,
        model: this.headroomModel,
      });
    } catch {
      // Sidecar failed — fall back to Stage-1-only output.
      const stage1Tokens = estimateTokens(stage1Text);
      const fallback: RouterOptimizerMetrics = {
        pre_token_count: preTokens,
        post_token_count: stage1Tokens,
        compression_ratio: preTokens > 0 ? stage1Tokens / preTokens : 1,
        protected_span_count: protectedSpans,
        wall_ms: Date.now() - wallStart,
        skipped: true,
        headroom_tokens_saved: 0,
        headroom_ratio: 0,
      };
      this.emitOptimizerMetrics(fallback);
      return { promptForBinary: stage1Text, optimizerMetrics: fallback };
    }

    // Reconstruct the final prompt from compressed messages. With a
    // single-turn input we expect a single user message back; if
    // Headroom adds turns (e.g. a system synopsis) we concatenate
    // their content with double-newlines.
    const finalPrompt = sidecarOut.compressed_messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .filter((s) => s.length > 0)
      .join('\n\n');

    const postTokens = sidecarOut.final_tokens;
    const metrics: RouterOptimizerMetrics = {
      pre_token_count: preTokens,
      post_token_count: postTokens,
      compression_ratio: preTokens > 0 ? postTokens / preTokens : 1,
      protected_span_count: protectedSpans,
      wall_ms: Date.now() - wallStart,
      skipped: false,
      headroom_tokens_saved: sidecarOut.tokens_saved,
      headroom_ratio: sidecarOut.compression_ratio,
    };
    this.emitOptimizerMetrics(metrics);
    return { promptForBinary: finalPrompt, optimizerMetrics: metrics };
  }

  /**
   * Invoke the Headroom Python sidecar.
   *
   * Tests pass `sidecarFn` to bypass the subprocess entirely. In
   * production we spawn `<headroomPython> <headroomSidecarPath>` and
   * pipe JSON in/out.
   */
  private async invokeSidecar(
    req: HeadroomSidecarRequest,
  ): Promise<HeadroomSidecarResponse> {
    if (this.sidecarFn) return this.sidecarFn(req);

    return new Promise<HeadroomSidecarResponse>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawnFn(this.headroomPython, [this.headroomSidecarPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...(process.env as Record<string, string>) },
        });
      } catch (err) {
        reject(new Error(`failed to spawn headroom sidecar: ${String(err)}`));
        return;
      }

      const stdin = child.stdin;
      if (!stdin) {
        reject(new Error('headroom sidecar has no stdin'));
        return;
      }

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }, this.headroomTimeoutMs);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
      child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`headroom sidecar error: ${String(err)}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`headroom sidecar timed out after ${String(this.headroomTimeoutMs)}ms`));
          return;
        }
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        if (code !== 0) {
          reject(
            new Error(
              `headroom sidecar exited ${String(code)}: ${stderr.slice(0, 500)}`,
            ),
          );
          return;
        }
        let parsed: HeadroomSidecarResponse;
        try {
          parsed = JSON.parse(stdout) as HeadroomSidecarResponse;
        } catch (e) {
          reject(new Error(`headroom sidecar bad JSON: ${String(e)}`));
          return;
        }
        if (!Array.isArray(parsed.compressed_messages)) {
          reject(new Error('headroom sidecar response missing compressed_messages array'));
          return;
        }
        resolve(parsed);
      });

      stdin.write(JSON.stringify(req));
      stdin.end();
    });
  }

  private emitOptimizerMetrics(metrics: RouterOptimizerMetrics): void {
    if (!this.onOptimizerMetrics) return;
    try {
      this.onOptimizerMetrics(metrics);
    } catch {
      /* sink errors must not break the dispatch */
    }
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
