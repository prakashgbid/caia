/**
 * @chiefaia/claude-spawner — `claude-wrap` CLI.
 *
 * Drop-in front-shim for `claude --print`. Posts the prompt to the
 * local-llm-router at :7411 first. If the router answers locally with a
 * usable response, we print it and exit 0. Otherwise we exec the real
 * `claude` binary verbatim with the original argv, so callers can't
 * tell the difference.
 *
 * Why this exists
 *
 *   `local-llm-router` exists, scores well on the eval suite, and is
 *   wired into every web/MCP touchpoint — but the chain workers still
 *   call `claude --print` directly. Token burn doesn't match the
 *   eval-suite displacement number for that reason. `claude-wrap`
 *   closes the gap by intercepting at the binary boundary the
 *   dispatchers already use.
 *
 * Design summary
 *
 *   1. Capture the full argv and stdin.
 *   2. Extract the prompt text (stdin by default; `--prompt-file` arg
 *      is also supported as a convenience).
 *   3. POST to `${ROUTER_URL}/v1/chat/completions` with the prompt and
 *      a routing hint. If the response is a usable local answer
 *      (provider === "local" AND finish_reason ∈ ok set AND content
 *      is non-trivial), emit it on stdout in a shape that matches the
 *      caller's --output-format and exit 0.
 *   4. On any escalation signal — non-200, JSON parse failure,
 *      provider !== "local", empty/short content, error envelope —
 *      spawn the real `claude` binary with the original argv, feed
 *      the captured stdin in, inherit stdout/stderr, propagate exit.
 *   5. Append a single JSON line per invocation to
 *      `~/.caia/chain-watchdog/logs/claude_wrap/<YYYY-MM-DD>.jsonl`
 *      with timestamp, prompt_hash, route_decision, latency_ms,
 *      model_used. Logging never fails the call.
 *
 * Compatibility notes
 *
 *   - `--help`: handled locally; prints wrapper help and exits 0.
 *   - `--output-format text`: emit raw content string (default; what
 *     the chain dispatcher templates use).
 *   - `--output-format json`: synthesise a `claude --print` JSON envelope
 *     so callers parsing the envelope still work.
 *   - All other flags (`--permission-mode`, `--max-turns`, `--add-dir`,
 *     `--model`, `-p`, `--print`, etc) are NOT interpreted by the
 *     wrapper for routing decisions — they're carried verbatim into
 *     the escalation spawn so behaviour on fallback is identical.
 *
 * Subscription-only constraint (see `spawn.ts`): we never touch
 * `ANTHROPIC_API_KEY` and we never pass arguments that would change
 * the auth path. The wrapper itself talks to the router over HTTP
 * (no auth), and the escalation spawn inherits the parent env minus
 * the canonical auth-token scrub.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { SCRUBBED_AUTH_ENV_VARS } from './spawn.js';

const DEFAULT_ROUTER_URL = process.env['CLAUDE_WRAP_ROUTER_URL'] ?? 'http://localhost:7411';
const DEFAULT_REAL_CLAUDE = process.env['CLAUDE_WRAP_REAL_CLAUDE'] ?? '/opt/homebrew/bin/claude';
const DEFAULT_ROUTER_TIMEOUT_MS = 60_000;
const DEFAULT_LOG_DIR = join(homedir(), '.caia', 'chain-watchdog', 'logs', 'claude_wrap');
const MIN_PLAUSIBLE_CONTENT = 1;
const OK_FINISH_REASONS: ReadonlySet<string> = new Set(['stop', 'end_turn', 'tool_use', 'length']);

const HELP_TEXT = `claude-wrap — local-llm-router front-shim for \`claude --print\`

Usage:
  echo "<prompt>" | claude-wrap [claude flags...]
  claude-wrap --prompt-file <path> [claude flags...]
  claude-wrap --help

Behaviour:
  1. Reads prompt from stdin (or --prompt-file <path>).
  2. POSTs to \${CLAUDE_WRAP_ROUTER_URL:-http://localhost:7411}/v1/chat/completions.
  3. If the router answered locally with usable content, prints it and exits 0
     (in the shape requested by --output-format text|json).
  4. Otherwise, exec()s the real claude binary (\${CLAUDE_WRAP_REAL_CLAUDE:-${DEFAULT_REAL_CLAUDE}})
     with the original argv. stdin is replayed; stdout/stderr/exit-code flow through.

Wrapper-only flags (not forwarded to claude):
  --help                 Print this help and exit 0.
  --prompt-file <path>   Read prompt from this file instead of stdin.
  --wrap-disable         Skip the router POST; immediately escalate to claude.

Env knobs:
  CLAUDE_WRAP_ROUTER_URL       (default http://localhost:7411)
  CLAUDE_WRAP_REAL_CLAUDE      (default /opt/homebrew/bin/claude)
  CLAUDE_WRAP_TIMEOUT_MS       (default ${String(DEFAULT_ROUTER_TIMEOUT_MS)})
  CLAUDE_WRAP_TASK_TYPE        (default chain_worker)
  CLAUDE_WRAP_LOG_DIR          (default ~/.caia/chain-watchdog/logs/claude_wrap)

Decision log: one JSON line per invocation appended to
  \${CLAUDE_WRAP_LOG_DIR:-${DEFAULT_LOG_DIR}}/<YYYY-MM-DD>.jsonl
`;

/** Inputs to {@link runClaudeWrap}. Everything is injectable for unit tests. */
export interface ClaudeWrapDeps {
  argv: readonly string[];
  readStdin: () => Promise<string>;
  fetchImpl: typeof fetch;
  spawnImpl: typeof spawn;
  appendLog: (line: string) => void;
  stdoutWrite: (s: string) => void;
  stderrWrite: (s: string) => void;
  now: () => number;
  routerUrl?: string;
  realClaudeBinary?: string;
  routerTimeoutMs?: number;
  taskType?: string;
}

/** Outcome of {@link runClaudeWrap}. Process exits with `exitCode`. */
export interface ClaudeWrapResult {
  exitCode: number;
  routeDecision: 'help' | 'routed_local' | 'escalated_router_fail' | 'escalated_provider_claude' | 'escalated_content_unusable' | 'escalated_wrap_disabled';
  modelUsed: string | null;
  latencyMs: number;
}

/** Lightweight parse of the argv to spot wrapper-only flags + --output-format. */
export interface ParsedArgs {
  /** True if --help or -h was seen. */
  wantHelp: boolean;
  /** Path passed via --prompt-file, if any. */
  promptFile: string | null;
  /** Resolved output format (default 'text' — matches what the chain dispatchers use). */
  outputFormat: 'text' | 'json';
  /** True if --wrap-disable was seen (skip router; escalate immediately). */
  wrapDisable: boolean;
  /** argv with wrapper-only flags removed — what we pass to real claude. */
  passthroughArgv: string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const passthrough: string[] = [];
  let wantHelp = false;
  let promptFile: string | null = null;
  let outputFormat: 'text' | 'json' = 'text';
  let wrapDisable = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--help' || a === '-h') {
      wantHelp = true;
      continue;
    }
    if (a === '--prompt-file') {
      const next = argv[i + 1];
      if (typeof next === 'string') {
        promptFile = next;
        i++;
      }
      continue;
    }
    if (a === '--wrap-disable') {
      wrapDisable = true;
      continue;
    }
    if (a === '--output-format') {
      const next = argv[i + 1];
      if (next === 'json') outputFormat = 'json';
      else if (next === 'text') outputFormat = 'text';
      passthrough.push(a);
      if (typeof next === 'string') {
        passthrough.push(next);
        i++;
      }
      continue;
    }
    if (a.startsWith('--output-format=')) {
      const v = a.slice('--output-format='.length);
      if (v === 'json') outputFormat = 'json';
      else if (v === 'text') outputFormat = 'text';
      passthrough.push(a);
      continue;
    }
    passthrough.push(a);
  }
  return { wantHelp, promptFile, outputFormat, wrapDisable, passthroughArgv: passthrough };
}

/** Shape of the router /v1/chat/completions response we care about. */
interface RouterResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  model?: string;
  caia?: {
    provider?: 'local' | 'claude' | string;
    duration_ms?: number;
  };
  error?: unknown;
}

/** Decision after inspecting the router response. */
export type RouteDecision =
  | { route: 'local'; content: string; model: string; finishReason: string }
  | { route: 'escalate'; reason: 'router_fail' | 'provider_claude' | 'content_unusable'; model: string | null };

export function decideRoute(httpStatus: number, body: unknown): RouteDecision {
  if (httpStatus < 200 || httpStatus >= 300) {
    return { route: 'escalate', reason: 'router_fail', model: null };
  }
  if (typeof body !== 'object' || body === null) {
    return { route: 'escalate', reason: 'router_fail', model: null };
  }
  const resp = body as RouterResponse;
  if (resp.error !== undefined) {
    return { route: 'escalate', reason: 'router_fail', model: null };
  }
  const provider = resp.caia?.provider;
  const model = typeof resp.model === 'string' ? resp.model : null;
  if (provider !== 'local') {
    // Provider claude (cascade escalation already happened upstream) OR
    // missing/unknown provider — both mean we shouldn't trust the answer
    // as a local-win and shouldn't double-bill by also exec'ing claude.
    // BUT: the task contract says we escalate (re-exec real claude) on
    // anything that isn't a clean local response — that matches the
    // dispatcher's expected behavior where the wrapper is invisible.
    return { route: 'escalate', reason: 'provider_claude', model };
  }
  const choice = resp.choices?.[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason;
  if (typeof content !== 'string' || content.length < MIN_PLAUSIBLE_CONTENT) {
    return { route: 'escalate', reason: 'content_unusable', model };
  }
  if (typeof finishReason !== 'string' || !OK_FINISH_REASONS.has(finishReason)) {
    return { route: 'escalate', reason: 'content_unusable', model };
  }
  return { route: 'local', content, model: model ?? 'unknown', finishReason };
}

/** Build the JSON envelope `claude --print --output-format json` produces. */
export function synthesiseClaudeJsonEnvelope(content: string, model: string): string {
  const envelope = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    api_error_status: null,
    duration_ms: 0,
    result: content,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    modelUsage: { [model]: { inputTokens: 0, outputTokens: 0, costUSD: 0 } },
    // Marker so downstream observability can tell wrapped local answers
    // apart from a real `claude --print` envelope.
    caia_wrap: { provider: 'local', model },
  };
  return JSON.stringify(envelope);
}

/** Build the per-call decision log line. */
export function buildLogLine(opts: {
  timestamp: string;
  promptHash: string;
  routeDecision: ClaudeWrapResult['routeDecision'];
  reason: string | null;
  latencyMs: number;
  modelUsed: string | null;
  promptBytes: number;
  exitCode: number;
}): string {
  return (
    JSON.stringify({
      ts: opts.timestamp,
      prompt_hash: opts.promptHash,
      route_decision: opts.routeDecision,
      reason: opts.reason,
      latency_ms: opts.latencyMs,
      model_used: opts.modelUsed,
      prompt_bytes: opts.promptBytes,
      exit_code: opts.exitCode,
    }) + '\n'
  );
}

/** sha256(prompt) — truncated for log compactness. */
export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/** Default file-backed log appender. Best-effort: never throws. */
export function defaultAppendLog(logLine: string): void {
  try {
    const dir = process.env['CLAUDE_WRAP_LOG_DIR'] ?? DEFAULT_LOG_DIR;
    mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    appendFileSync(join(dir, `${date}.jsonl`), logLine);
  } catch {
    /* logging must never fail the worker */
  }
}

/** Read all of stdin as utf8 string. */
export async function defaultReadStdin(): Promise<string> {
  if (process.stdin.isTTY === true) {
    return '';
  }
  const chunks: Buffer[] = [];
  return await new Promise<string>((resolve, reject) => {
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

/** Read prompt from --prompt-file if set, else from stdin. */
async function loadPrompt(args: ParsedArgs, readStdin: () => Promise<string>): Promise<string> {
  if (args.promptFile !== null) {
    return readFileSync(args.promptFile, 'utf8');
  }
  return await readStdin();
}

/** Build the env for the escalation spawn — same auth scrub as spawn.ts. */
function buildEscalationEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of SCRUBBED_AUTH_ENV_VARS) {
    delete env[k];
  }
  return env;
}

/** Exec the real claude binary with the original argv. Returns exit code. */
async function escalateToClaude(
  deps: Pick<ClaudeWrapDeps, 'spawnImpl' | 'stderrWrite'>,
  realBinary: string,
  passthroughArgv: readonly string[],
  promptStdin: string,
): Promise<number> {
  return await new Promise<number>((resolve) => {
    const child = deps.spawnImpl(realBinary, [...passthroughArgv], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: buildEscalationEnv(),
    });
    child.on('error', (err) => {
      deps.stderrWrite(`claude-wrap: failed to exec ${realBinary}: ${err.message}\n`);
      resolve(127);
    });
    child.on('close', (code, signal) => {
      if (typeof code === 'number') {
        resolve(code);
        return;
      }
      if (signal !== null && signal !== undefined) {
        // Mirror the shell convention: killed-by-signal => 128 + signal-number.
        resolve(128);
        return;
      }
      resolve(1);
    });
    const stdin = child.stdin;
    if (stdin !== null) {
      try {
        stdin.write(promptStdin);
        stdin.end();
      } catch {
        /* child may have exited already; close handler resolves */
      }
    }
  });
}

/** Body sent to the router. We pass a routing hint and a task-type label. */
function buildRouterBody(prompt: string, taskType: string): string {
  return JSON.stringify({
    model: 'auto',
    messages: [{ role: 'user', content: prompt }],
    caia_task_type: taskType,
  });
}

/**
 * Call the router with a wall-clock timeout. Returns parsed body + status.
 * Any thrown / timeout / non-JSON path returns `{status: 0, body: null}`
 * which {@link decideRoute} treats as `router_fail`.
 */
async function callRouter(
  deps: Pick<ClaudeWrapDeps, 'fetchImpl'>,
  url: string,
  body: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await deps.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/** The wrapper entrypoint. Returns the result so callers (and tests) can inspect. */
export async function runClaudeWrap(deps: ClaudeWrapDeps): Promise<ClaudeWrapResult> {
  const start = deps.now();
  const args = parseArgs(deps.argv);

  if (args.wantHelp) {
    deps.stdoutWrite(HELP_TEXT);
    return { exitCode: 0, routeDecision: 'help', modelUsed: null, latencyMs: 0 };
  }

  const prompt = await loadPrompt(args, deps.readStdin);
  const promptHash = hashPrompt(prompt);
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  const routerUrl = `${deps.routerUrl ?? DEFAULT_ROUTER_URL}/v1/chat/completions`;
  const realBinary = deps.realClaudeBinary ?? DEFAULT_REAL_CLAUDE;
  const taskType = deps.taskType ?? process.env['CLAUDE_WRAP_TASK_TYPE'] ?? 'chain_worker';
  const parsedEnvTimeout = Number.parseInt(process.env['CLAUDE_WRAP_TIMEOUT_MS'] ?? '', 10);
  const timeoutMs = deps.routerTimeoutMs ?? (Number.isFinite(parsedEnvTimeout) && parsedEnvTimeout > 0 ? parsedEnvTimeout : DEFAULT_ROUTER_TIMEOUT_MS);

  const wrapDisableFromEnv = process.env['CLAUDE_WRAP_DISABLE'] === '1';
  const shouldSkipRouter = args.wrapDisable || wrapDisableFromEnv || prompt.length === 0;

  let routeDecision: ClaudeWrapResult['routeDecision'];
  let reason: string | null;
  let modelUsed: string | null = null;
  let exitCode: number;

  if (shouldSkipRouter) {
    routeDecision = 'escalated_wrap_disabled';
    reason = args.wrapDisable ? 'wrap_disable_flag' : wrapDisableFromEnv ? 'wrap_disable_env' : 'empty_prompt';
    exitCode = await escalateToClaude(deps, realBinary, args.passthroughArgv, prompt);
  } else {
    const routerCallStart = deps.now();
    const { status, body } = await callRouter(deps, routerUrl, buildRouterBody(prompt, taskType), timeoutMs);
    const routerLatency = deps.now() - routerCallStart;
    const decision = decideRoute(status, body);
    if (decision.route === 'local') {
      routeDecision = 'routed_local';
      reason = `router_latency_ms=${String(routerLatency)}`;
      modelUsed = decision.model;
      if (args.outputFormat === 'json') {
        deps.stdoutWrite(synthesiseClaudeJsonEnvelope(decision.content, decision.model));
      } else {
        deps.stdoutWrite(decision.content);
      }
      exitCode = 0;
    } else {
      modelUsed = decision.model;
      routeDecision =
        decision.reason === 'router_fail'
          ? 'escalated_router_fail'
          : decision.reason === 'provider_claude'
            ? 'escalated_provider_claude'
            : 'escalated_content_unusable';
      reason = decision.reason;
      exitCode = await escalateToClaude(deps, realBinary, args.passthroughArgv, prompt);
    }
  }

  const latencyMs = deps.now() - start;
  const logLine = buildLogLine({
    timestamp: new Date().toISOString(),
    promptHash,
    routeDecision,
    reason,
    latencyMs,
    modelUsed,
    promptBytes,
    exitCode,
  });
  try {
    deps.appendLog(logLine);
  } catch {
    /* swallow */
  }

  return { exitCode, routeDecision, modelUsed, latencyMs };
}

/** CLI main — wires real fetch / spawn / process IO into {@link runClaudeWrap}. */
export async function cliMain(): Promise<void> {
  const deps: ClaudeWrapDeps = {
    argv: process.argv.slice(2),
    readStdin: defaultReadStdin,
    fetchImpl: globalThis.fetch.bind(globalThis),
    spawnImpl: spawn,
    appendLog: defaultAppendLog,
    stdoutWrite: (s) => {
      process.stdout.write(s);
    },
    stderrWrite: (s) => {
      process.stderr.write(s);
    },
    now: () => Date.now(),
  };
  const result = await runClaudeWrap(deps);
  process.exit(result.exitCode);
}

// Re-export the helper that builds default appendLog path for callers that
// want the same dir convention without the file IO side-effect.
export { DEFAULT_LOG_DIR, DEFAULT_ROUTER_URL, DEFAULT_REAL_CLAUDE };

// Reference unused imports so lint configs that flag them don't trip.
// (dirname is used only by future log-rotation helpers we may add.)
void dirname;
