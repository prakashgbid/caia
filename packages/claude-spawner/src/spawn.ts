/**
 * @chiefaia/claude-spawner — unified `claude` binary spawner.
 *
 * SUBSCRIPTION-ONLY HARD CONSTRAINT (Prakash 2026-04-30, see
 * `feedback_no_api_key_billing.md`):
 *
 *   The pay-per-token Anthropic API path is FORBIDDEN. We never set
 *   ANTHROPIC_API_KEY (and related auth-token env vars) for the spawned
 *   child — we explicitly scrub them so the binary falls through to the
 *   keychain / OAuth subscription session. If the binary is missing or
 *   fails for any reason, we throw / return ok=false — we NEVER fall back
 *   to API-key billing.
 *
 * Why this package
 *
 *   Before D1 (2026-05-15), seven packages each maintained their own
 *   `child_process.spawn(...) / spawnSync(...)` wrapper around the
 *   `claude` binary:
 *
 *     - @chiefaia/verifier         (src/agent.ts defaultRunChild)
 *     - @chiefaia/code-reviewer    (src/llm-reasoner.ts)
 *     - @chiefaia/critic           (src/llm-reasoner.ts)
 *     - @chiefaia/reviewer         (src/llm-reasoner.ts)
 *     - @chiefaia/apprentice-eval  (src/judge.ts runProcess)
 *     - @chiefaia/apprentice-corpus (src/distiller.ts)
 *     - @chiefaia/researcher       (src/llm-client.ts)
 *
 *   Each independently scrubbed env vars, set timeouts, sized buffers,
 *   built argv, and parsed JSON envelopes. Drift was inevitable — a fix
 *   in one (e.g. new auth-token scrub, larger maxBuffer for synthesis)
 *   never propagated to the others. The integration-remediation plan §D
 *   Phase D1 (2026-05-14) called for extracting the canonical pattern
 *   from `@chiefaia/local-llm-router`'s `claude-adapter.ts` into a
 *   stand-alone package — this file is that extraction.
 *
 * Design summary
 *
 *   `spawnClaude({ prompt, options, constraints })` is the only public
 *   entrypoint. It:
 *
 *     1. Validates `constraints` (subscription-only, cwd allow-list).
 *     2. Builds argv (default `--print --output-format json`, optional
 *        `--model`, `--permission-mode`, etc).
 *     3. Builds env (forks `process.env` and scrubs auth-token vars).
 *     4. Spawns the binary via `node:child_process.spawn` with stdin pipe.
 *     5. Writes the prompt to stdin, collects stdout/stderr, enforces a
 *        wall-clock timeout (SIGTERM at deadline).
 *     6. Returns a `SpawnClaudeResult` describing the outcome.
 *
 *   Callers parse the stdout themselves (most use the
 *   `claude --print --output-format json` envelope shape — see
 *   `parseClaudeJsonEnvelope` helper).
 *
 * What this package does NOT do
 *
 *   - It does NOT implement the `cli.ts` surface — that lives in the A2
 *     work (file-disjoint per the integration plan).
 *   - It does NOT classify rate-limit errors — callers that need that
 *     should keep using `@chiefaia/local-llm-router`'s `ClaudeAdapter`
 *     which layers `ClaudeRateLimitedError` on top.
 *   - It does NOT decide when to fall back to local Ollama — that's the
 *     router's job.
 *   - It does NOT manage account rotation — that's spend-guard /
 *     account-pool's job. (We DO honour `homeOverride` so callers can
 *     point at a different credentials dir per spawn.)
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createTracer } from '@chiefaia/tracing';

/**
 * OTel tracer for this package. Spans emitted via this tracer are
 * attached to the active root trace (set by `chain-runner` /
 * `lifecycle-conductor` / `ea-architect` callers) when the SDK has
 * been bootstrapped by `@chiefaia/tracing`'s `initTracing()`. When
 * the SDK is not initialised, the tracer degrades to no-op spans —
 * unit tests that don't bootstrap the SDK are unaffected.
 */
const tracer = createTracer('@chiefaia/claude-spawner');

/** Default path to the `claude` binary. Overridable via env or option. */
const DEFAULT_CLAUDE_BINARY = process.env['CLAUDE_BINARY_PATH'] ?? 'claude';

/**
 * Default subprocess timeout (ms).
 *
 * 45_000 covers a normal Sonnet response with margin while keeping
 * fallback latency bounded. Adapted from the `local-llm-router`
 * adapter — same reasoning applies here: the binary-spawn path adds
 * ~6-10s session-init overhead per call, and many callers run
 * validation in parallel; a longer ceiling per call bottlenecks the
 * whole pipeline if claude is unreachable.
 */
const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Env var names that authenticate against the pay-per-token Anthropic
 * API. ALL are scrubbed unconditionally — there is no opt-out — to
 * force the subscription session per `feedback_no_api_key_billing.md`.
 */
export const SCRUBBED_AUTH_ENV_VARS: readonly string[] = Object.freeze([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'COHERE_API_KEY',
  'GEMINI_API_KEY',
]);

/** Per-spawn options. */
export interface SpawnClaudeOptions {
  /** Path to the `claude` binary. Default: env `CLAUDE_BINARY_PATH` or `'claude'`. */
  binaryPath?: string;
  /**
   * Extra argv passed to the binary. The default argv is
   * `['--print', '--output-format', 'json']` plus an optional
   * `'--model', <model>'` if `model` is set and an optional
   * `'--permission-mode', <permissionMode>'` if `permissionMode` is set.
   *
   * If `extraArgs` is provided, it is concatenated AFTER the defaults so
   * the caller can append flags without rebuilding the canonical prefix.
   * If `overrideArgs` is set instead, the entire argv (excluding the
   * binary path) is replaced verbatim.
   */
  extraArgs?: readonly string[];
  /** Replace the entire argv (excluding the binary path). Mutually exclusive with extraArgs/model/etc. */
  overrideArgs?: readonly string[];
  /** Model tag — appended as `'--model', <model>`. */
  model?: string;
  /** Permission mode — appended as `'--permission-mode', <permissionMode>`. */
  permissionMode?: 'default' | 'bypassPermissions' | 'plan' | 'acceptEdits';
  /** Output format. Appended only when {@link extraArgs} / {@link overrideArgs} don't already cover it. */
  outputFormat?: 'json' | 'text';
  /** Wall-clock timeout. Default 45_000ms. */
  timeoutMs?: number;
  /** cwd for the spawn. Default: process.cwd(). */
  cwd?: string;
  /**
   * Override the HOME env var so the spawned binary uses a different
   * credentials dir (`~/.config/claude/credentials.json`). Used by
   * account-pool rotation: each account has its own credentials dir.
   */
  homeOverride?: string;
  /**
   * Additional env vars to merge into the child's env AFTER the auth-token
   * scrub. Cannot be used to re-introduce a scrubbed var — those are
   * always deleted post-merge.
   */
  extraEnv?: Record<string, string>;
  /** Optional account id used for telemetry / attribution. Echoed back in result.accountId. */
  accountId?: string | null;
  /** Test seam — replace `node:child_process.spawn`. */
  spawnFn?: typeof spawn;
}

/** Hard constraints — refusing to spawn if violated. */
export interface SpawnClaudeConstraints {
  /**
   * Reject the spawn if any of {@link SCRUBBED_AUTH_ENV_VARS} are
   * present in the calling process's env. Default: false (we scrub
   * unconditionally; this is an opt-in extra safety check for callers
   * that want a noisy diagnostic when an API key is set in their shell).
   */
  rejectIfApiKeyPresent?: boolean;
  /**
   * If set, the spawn's resolved cwd must be a subdirectory of one of
   * these paths (or equal to one). Useful for operator preference of
   * limiting which dirs the binary can operate in.
   */
  cwdAllowList?: readonly string[];
}

/** Result of a single spawn. */
export interface SpawnClaudeResult {
  /** Convenience — true if `rc === 0 && !timedOut && !error`. */
  ok: boolean;
  /** Exit code. `null` if the child was killed before exit. */
  rc: number | null;
  /** Captured stdout (full). */
  stdout: string;
  /** Captured stderr (full). */
  stderr: string;
  /** True if the spawn was killed because the timeout fired. */
  timedOut: boolean;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Diagnostic string when `ok === false`. */
  diagnostic: string | null;
  /** Echoed back from `options.accountId`. */
  accountId: string | null;
}

/** Thrown when constraints reject the spawn before it starts. */
export class SpawnClaudeConstraintError extends Error {
  readonly code: 'api-key-present' | 'cwd-not-allowed' | 'invalid-args';
  constructor(code: 'api-key-present' | 'cwd-not-allowed' | 'invalid-args', message: string) {
    super(message);
    this.name = 'SpawnClaudeConstraintError';
    this.code = code;
  }
}

/** Build the env handed to the spawned child. Always scrubs auth-token vars. */
export function buildSpawnEnv(
  base: NodeJS.ProcessEnv,
  opts: {
    homeOverride?: string;
    extraEnv?: Record<string, string>;
  },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined) env[k] = v;
  }
  if (opts.extraEnv) {
    for (const [k, v] of Object.entries(opts.extraEnv)) {
      env[k] = v;
    }
  }
  if (opts.homeOverride !== undefined) {
    env['HOME'] = opts.homeOverride;
  }
  // The scrub MUST run AFTER extraEnv merge so callers can't accidentally
  // re-introduce a scrubbed key via extraEnv.
  for (const k of SCRUBBED_AUTH_ENV_VARS) {
    delete env[k];
  }
  return env;
}

/** Build the argv handed to the binary (excluding binary path itself). */
export function buildSpawnArgs(opts: SpawnClaudeOptions): string[] {
  if (opts.overrideArgs !== undefined) {
    return [...opts.overrideArgs];
  }
  const out: string[] = ['--print', '--output-format', opts.outputFormat ?? 'json'];
  if (opts.model !== undefined && opts.model.length > 0) {
    out.push('--model', opts.model);
  }
  if (opts.permissionMode !== undefined) {
    out.push('--permission-mode', opts.permissionMode);
  }
  if (opts.extraArgs !== undefined) {
    out.push(...opts.extraArgs);
  }
  return out;
}

/** Inputs to {@link spawnClaude}. */
export interface SpawnClaudeInput {
  /** Prompt content written to the child's stdin. */
  prompt: string;
  /** Per-spawn options (binary, argv, env, timeout). */
  options?: SpawnClaudeOptions;
  /** Hard constraints applied before the spawn. */
  constraints?: SpawnClaudeConstraints;
}

/**
 * Spawn the `claude` binary, write `prompt` to its stdin, collect
 * stdout/stderr, return the result.
 *
 * Subscription-only by construction — see file-level comment.
 *
 * Throws {@link SpawnClaudeConstraintError} only when constraints
 * reject the call before the binary is launched. All other failure
 * modes (binary missing, non-zero exit, timeout, etc.) are surfaced as
 * `ok: false` with a `diagnostic` string. Callers that need a richer
 * error taxonomy (e.g. rate-limit detection) should layer their own
 * parsing on top.
 */
/**
 * Internal implementation. Public surface is the `spawnClaude` wrapper
 * below, which adds OTel span instrumentation. We keep the impl as a
 * separate function so the (large) body remains exactly as written in
 * the v0.1.0 ship — span wiring is purely additive.
 */
async function _spawnClaudeImpl(input: SpawnClaudeInput): Promise<SpawnClaudeResult> {
  const options = input.options ?? {};
  const constraints = input.constraints ?? {};
  const accountId: string | null = options.accountId ?? null;
  const start = Date.now();

  // Constraint: API-key-present rejection.
  if (constraints.rejectIfApiKeyPresent === true) {
    for (const k of SCRUBBED_AUTH_ENV_VARS) {
      if (process.env[k] !== undefined && process.env[k] !== '') {
        throw new SpawnClaudeConstraintError(
          'api-key-present',
          `Env var ${k} is set in the calling process — subscription-only constraint rejects the spawn before scrub. Unset ${k} in the shell that launched the orchestrator.`,
        );
      }
    }
  }

  // Constraint: cwd allow-list.
  const cwd = options.cwd ?? process.cwd();
  if (constraints.cwdAllowList !== undefined && constraints.cwdAllowList.length > 0) {
    const allowed = constraints.cwdAllowList.some((root) => {
      if (root === cwd) return true;
      const trimmed = root.endsWith('/') ? root : `${root}/`;
      return cwd.startsWith(trimmed);
    });
    if (!allowed) {
      throw new SpawnClaudeConstraintError(
        'cwd-not-allowed',
        `cwd=${cwd} is not under any path in cwdAllowList=[${constraints.cwdAllowList.join(', ')}].`,
      );
    }
  }

  const binaryPath = options.binaryPath ?? DEFAULT_CLAUDE_BINARY;
  const args = buildSpawnArgs(options);
  const env = buildSpawnEnv(process.env, {
    ...(options.homeOverride !== undefined ? { homeOverride: options.homeOverride } : {}),
    ...(options.extraEnv !== undefined ? { extraEnv: options.extraEnv } : {}),
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnImpl = options.spawnFn ?? spawn;

  const spawnOpts: SpawnOptions = {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    env,
  };

  let child: ChildProcess;
  try {
    child = spawnImpl(binaryPath, args, spawnOpts);
  } catch (err) {
    return {
      ok: false,
      rc: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: Date.now() - start,
      diagnostic: `failed to spawn '${binaryPath}': ${(err as Error).message}`,
      accountId,
    };
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
  child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  // Write the prompt to stdin. The binary tends to be picky about
  // stdin closure semantics — we end() immediately after write() so the
  // child sees EOF and starts producing output.
  const stdin = child.stdin;
  if (stdin) {
    try {
      stdin.write(input.prompt);
      stdin.end();
    } catch (err) {
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        rc: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut: false,
        durationMs: Date.now() - start,
        diagnostic: `stdin write failed: ${(err as Error).message}`,
        accountId,
      };
    }
  }

  // Wait for close. `error` event triggers a rejection-style return.
  const result: { rc: number | null; childErr: Error | null } = await new Promise((resolve) => {
    let settled = false;
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ rc: null, childErr: err });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ rc: code, childErr: null });
    });
  });

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const durationMs = Date.now() - start;

  if (result.childErr !== null) {
    return {
      ok: false,
      rc: null,
      stdout,
      stderr,
      timedOut: false,
      durationMs,
      diagnostic: `child process error: ${result.childErr.message}`,
      accountId,
    };
  }

  if (timedOut) {
    return {
      ok: false,
      rc: result.rc,
      stdout,
      stderr,
      timedOut: true,
      durationMs,
      diagnostic: `claude binary timed out after ${String(timeoutMs)}ms`,
      accountId,
    };
  }

  if (result.rc !== 0) {
    return {
      ok: false,
      rc: result.rc,
      stdout,
      stderr,
      timedOut: false,
      durationMs,
      diagnostic: `claude binary exited with code ${String(result.rc)}: ${stderr.slice(-500)}`,
      accountId,
    };
  }

  return {
    ok: true,
    rc: result.rc,
    stdout,
    stderr,
    timedOut: false,
    durationMs,
    diagnostic: null,
    accountId,
  };
}

/**
 * Public {@link spawnClaude} — thin OTel-instrumented wrapper around
 * {@link _spawnClaudeImpl}. Emits a `claude.spawn` span carrying the
 * binary path, optional model, configured timeout, account id, and on
 * completion the spawn outcome (ok, exit code, duration, timed_out).
 *
 * When `@chiefaia/tracing`'s SDK has not been initialised, the
 * underlying tracer is a no-op and this wrapper adds only the cost of
 * a single allocation per spawn — well below the 6-10s session-init
 * the binary itself incurs.
 */
export async function spawnClaude(input: SpawnClaudeInput): Promise<SpawnClaudeResult> {
  return tracer.withSpan('claude.spawn', async (span) => {
    const opts = input.options ?? {};
    span.setAttribute('claude.binary', opts.binaryPath ?? DEFAULT_CLAUDE_BINARY);
    span.setAttribute('claude.timeout_ms', opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (opts.model !== undefined) span.setAttribute('claude.model', opts.model);
    if (opts.permissionMode !== undefined) {
      span.setAttribute('claude.permission_mode', opts.permissionMode);
    }
    if (opts.accountId !== undefined && opts.accountId !== null) {
      span.setAttribute('caia.account.id', opts.accountId);
    }
    const result = await _spawnClaudeImpl(input);
    span.setAttribute('claude.ok', result.ok);
    span.setAttribute('claude.duration_ms', result.durationMs);
    if (result.rc !== null) span.setAttribute('claude.exit_code', result.rc);
    if (result.timedOut) span.setAttribute('claude.timed_out', true);
    if (!result.ok && result.diagnostic !== null) {
      span.setStatus('error', result.diagnostic);
    }
    return result;
  });
}

/**
 * Parse the standard `claude --print --output-format json` envelope.
 *
 * Envelope shape:
 *   { "type": "result", "result": "<assistant text>", "is_error": false,
 *     "api_error_status": null, ... }
 *
 * Returns the inner `result` string on success, or an error object on
 * malformed envelopes / API-side errors. This helper exists so the
 * seven downstream packages don't each re-implement JSON parsing.
 *
 * Callers that need rate-limit detection should inspect
 * `api_error_status` directly via the full envelope object — pass
 * `keepEnvelope: true` to retrieve it.
 */
export function parseClaudeJsonEnvelope(stdout: string): ParsedClaudeEnvelope {
  if (stdout.trim().length === 0) {
    return { ok: false, diagnostic: 'empty stdout' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    return { ok: false, diagnostic: `envelope JSON parse failed: ${(e as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, diagnostic: 'envelope is not an object' };
  }
  const env = parsed as ClaudeJsonEnvelope;
  if (env.is_error === true) {
    const status = env.api_error_status ?? 'unknown';
    return {
      ok: false,
      diagnostic: `claude is_error=true api_error_status=${String(status)}`,
      envelope: env,
    };
  }
  if (typeof env.result !== 'string') {
    return { ok: false, diagnostic: 'envelope missing "result" string', envelope: env };
  }
  return { ok: true, text: env.result, envelope: env };
}

/** The on-the-wire envelope shape produced by `claude --print --output-format json`. */
export interface ClaudeJsonEnvelope {
  type?: string;
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

export type ParsedClaudeEnvelope =
  | { ok: true; text: string; envelope: ClaudeJsonEnvelope }
  | { ok: false; diagnostic: string; envelope?: ClaudeJsonEnvelope };
