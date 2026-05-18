// H-4 (chain-runner-battle-harden phase 4, 2026-05-14). Pre-dispatch health
// gate. Probes the claude binary BEFORE the wake script spawns a worker so
// the most common worker-no-start failure modes (rate-limit, auth, missing
// binary, ANTHROPIC_API_KEY leak) are caught synchronously with a clean
// classification + reset-time annotation rather than a 60-min watchdog
// stall.
//
// Companion: src/retry-policy.ts (classes), reports/chain_runner_hardening_plan_2026-05-14.md §H-4.
//
// Exit-code contract (consumed by wake scripts):
//   0  healthy        — claude is up, auth ok, no rate limit
//   1  generic error  — preflight infra issue (file IO, internal exception)
//   2  rate_limited   — banner matched; result.resetTimestamp may be present
//   3  auth_failure   — banner matched; token rejected
//   4  timeout        — claude did not respond within timeoutMs
//   5  unknown        — claude responded but neither healthy nor
//                       a recognized failure banner; full stdout in result.raw
//   6  api_key_leak   — ANTHROPIC_API_KEY is set in the environment

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type PreflightStatus =
  | 'healthy'
  | 'rate_limited'
  | 'auth_failure'
  | 'timeout'
  | 'unknown'
  | 'api_key_leak'
  | 'preflight_error';

export interface PreflightDispatchOptions {
  /** Path to the claude binary. Defaults to `claude` (PATH-resolved). */
  binary?: string;
  /** Prompt sent via --print --max-turns 1 -p '<prompt>'. */
  prompt?: string;
  /** Overall wallclock timeout (ms). Default 15000. */
  timeoutMs?: number;
  /** Override env for the spawned process. Mainly for tests. */
  env?: NodeJS.ProcessEnv;
  /**
   * Refuse if ANTHROPIC_API_KEY is set. Default true. Standing rule:
   * subscription-only billing — a leaked API key means the chain is about to
   * burn API credit instead of consuming the subscription quota.
   */
  refuseIfApiKeySet?: boolean;
  /**
   * When set, the raw stdout+stderr is also appended to this path so wake
   * scripts can grep the reset time directly (used by D-4 paused_until).
   */
  logPath?: string;
}

export interface PreflightDispatchResult {
  status: PreflightStatus;
  exit_code: number;
  /** Human-friendly summary, one line. */
  message: string;
  /** Wallclock from spawn to settle (ms). */
  elapsed_ms: number;
  /** Raw output (stdout+stderr), capped to ~32 KB. */
  raw: string;
  /** When status === 'rate_limited' and a reset banner was parsed. */
  reset_iso?: string;
  /** Verbatim reset banner sub-match, for audit. */
  reset_banner?: string;
}

export const DEFAULT_PROMPT = 'reply with PREFLIGHT_OK in one word';
export const DEFAULT_TIMEOUT_MS = 15000;
export const RAW_CAP_BYTES = 32 * 1024;

// Banner regexes. Mirror src/classify.ts:LOG_PATTERNS but tightened — these
// fire on live preflight output, not post-mortem log scrapes.
const RE_RATE_LIMIT = /You(?:'|’)ve hit your limit/i;
const RE_AUTH_FAIL =
  /Invalid authentication credentials|API Error 401|Unauthorized: invalid (?:api )?key|authentication_error/i;
const RE_HEALTHY = /PREFLIGHT_OK/;

// Reset banner. Two forms observed in the wild on the 2026-05-14 incident:
//   "resets May 16 at 12pm (America/New_York)"
//   "resets 4pm (America/New_York)"
//   "resets at 12pm"
// We make month/day optional, allow `at`, and capture the local-time tz.
export const RE_RESET = /resets\s+(?:([A-Z][a-z]+)\s+(\d{1,2})\s+)?(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:\(([A-Za-z_]+\/[A-Za-z_]+)\))?/i;

// Parse a reset banner into UTC ISO. Returns null if the banner is missing.
// Strategy: take the captured (month-name day time tz?) and shape it into a
// JS-parseable string. When tz is omitted, default to UTC; when month/day are
// omitted, default to "today" relative to nowMs and bump to tomorrow if the
// time has already passed.
export function parseResetIsoFromBanner(
  raw: string,
  nowMs: number = Date.now(),
): { iso: string | null; matched: string | null } {
  const m = RE_RESET.exec(raw);
  if (!m) return { iso: null, matched: null };
  const monthName = m[1];
  const dayStr = m[2];
  const timeStr = (m[3] ?? '').trim();
  const tzName = m[4] ?? null;
  if (!timeStr) return { iso: null, matched: m[0] };

  // Parse the time portion (e.g. "12pm", "4:30pm").
  const tm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(timeStr);
  if (!tm) return { iso: null, matched: m[0] };
  let hour = parseInt(tm[1] ?? '0', 10);
  const minute = parseInt(tm[2] ?? '0', 10);
  const meridiem = (tm[3] ?? '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  let dateObj: Date | null = null;
  if (monthName && dayStr) {
    // Year defaults to "now" — banners never carry a year. If the parsed
    // date is more than 30 days in the past, bump it +1y.
    const now = new Date(nowMs);
    const yr = now.getUTCFullYear();
    // Use ISO month names → JS Date via month parsing.
    const tryStr = `${monthName} ${dayStr} ${yr} ${pad(hour)}:${pad(minute)}:00 ${tzAbbrFor(tzName) ?? 'UTC'}`;
    const candidate = new Date(tryStr);
    if (!Number.isNaN(candidate.getTime())) {
      if (candidate.getTime() < nowMs - 30 * 24 * 60 * 60 * 1000) {
        candidate.setUTCFullYear(yr + 1);
      }
      dateObj = candidate;
    }
  } else {
    // No month/day — assume "today, in tz" and bump to tomorrow if the time
    // has already passed.
    const now = new Date(nowMs);
    const todayStr = `${pad(now.getUTCFullYear())}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
    const tryStr = `${todayStr}T${pad(hour)}:${pad(minute)}:00${tzOffsetFor(tzName) ?? 'Z'}`;
    const candidate = new Date(tryStr);
    if (!Number.isNaN(candidate.getTime())) {
      if (candidate.getTime() <= nowMs) {
        candidate.setUTCDate(candidate.getUTCDate() + 1);
      }
      dateObj = candidate;
    }
  }
  if (!dateObj) return { iso: null, matched: m[0] };
  return {
    iso: dateObj.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    matched: m[0],
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Best-effort TZ name → ISO offset. We don't ship a full tzdata; covers the
// account-region timezones observed on this account.
function tzOffsetFor(tz: string | null): string | null {
  if (!tz) return null;
  switch (tz) {
    case 'America/New_York':
      return '-04:00'; // approx; DST handled by JS Date when we reparse
    case 'America/Los_Angeles':
      return '-07:00';
    case 'America/Chicago':
      return '-05:00';
    case 'UTC':
    case 'Etc/UTC':
      return 'Z';
    default:
      return null;
  }
}

function tzAbbrFor(tz: string | null): string | null {
  if (!tz) return null;
  switch (tz) {
    case 'America/New_York':
      return 'EDT';
    case 'America/Los_Angeles':
      return 'PDT';
    case 'America/Chicago':
      return 'CDT';
    case 'UTC':
    case 'Etc/UTC':
      return 'UTC';
    default:
      return null;
  }
}

// Append a one-line raw-output dump to logPath. Best effort — preflight is
// not blocking on log writes.
function appendLog(logPath: string, body: string): void {
  try {
    if (!existsSync(dirname(logPath))) return;
    const cap = body.length > RAW_CAP_BYTES ? body.slice(-RAW_CAP_BYTES) : body;
    // Prepend timestamp + role for context.
    const ts = new Date().toISOString();
    const existing = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    writeFileSync(logPath, `${existing}--- preflight ${ts} ---\n${cap}\n`);
  } catch {
    // ignore — preflight reports via return value, log is a convenience.
  }
}

export async function preflightDispatch(
  opts: PreflightDispatchOptions = {},
): Promise<PreflightDispatchResult> {
  const env = opts.env ?? process.env;
  const refuseIfApiKey = opts.refuseIfApiKeySet ?? true;
  if (refuseIfApiKey && typeof env['ANTHROPIC_API_KEY'] === 'string' && env['ANTHROPIC_API_KEY'].length > 0) {
    const msg =
      'ANTHROPIC_API_KEY is set in the environment — subscription-only billing requires it unset';
    return {
      status: 'api_key_leak',
      exit_code: 6,
      message: msg,
      elapsed_ms: 0,
      raw: '',
    };
  }
  const binary = opts.binary ?? 'claude';
  const prompt = opts.prompt ?? DEFAULT_PROMPT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const t0 = Date.now();

  return new Promise<PreflightDispatchResult>((resolve) => {
    let settled = false;
    let raw = '';
    const settle = (result: PreflightDispatchResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners();
      if (opts.logPath) appendLog(opts.logPath, raw);
      try {
        child.kill('SIGKILL');
      } catch {
        // already exited
      }
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        binary,
        ['--print', '--max-turns', '1', '-p', prompt],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        },
      );
    } catch (err) {
      resolve({
        status: 'preflight_error',
        exit_code: 1,
        message: `failed to spawn ${binary}: ${(err as Error).message}`,
        elapsed_ms: Date.now() - t0,
        raw: '',
      });
      return;
    }

    const timer = setTimeout(() => {
      settle({
        status: 'timeout',
        exit_code: 4,
        message: `preflight timed out after ${timeoutMs}ms`,
        elapsed_ms: Date.now() - t0,
        raw,
      });
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      raw += chunk.toString('utf8');
      if (raw.length > RAW_CAP_BYTES * 2) {
        raw = raw.slice(-RAW_CAP_BYTES);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (err) => {
      // ENOENT (binary not on PATH), EACCES, etc. Don't classify here as
      // binary_missing — that's the wake script's job after seeing exit 1
      // or exit 5; we expose the raw error in `message`.
      settle({
        status: 'preflight_error',
        exit_code: 1,
        message: `${binary} spawn error: ${(err as { code?: string; message: string }).code ?? err.message}`,
        elapsed_ms: Date.now() - t0,
        raw,
      });
    });
    child.once('close', (code) => {
      const elapsed = Date.now() - t0;
      // Decision tree: rate-limit FIRST (banner is the most specific), then
      // auth, then healthy, then everything else → unknown.
      if (RE_RATE_LIMIT.test(raw)) {
        const parsed = parseResetIsoFromBanner(raw, t0);
        const result: PreflightDispatchResult = {
          status: 'rate_limited',
          exit_code: 2,
          message: parsed.matched
            ? `rate limit hit (${parsed.matched.trim()})`
            : 'rate limit hit (no reset banner parsed)',
          elapsed_ms: elapsed,
          raw,
        };
        if (parsed.iso) result.reset_iso = parsed.iso;
        if (parsed.matched) result.reset_banner = parsed.matched;
        settle(result);
        return;
      }
      if (RE_AUTH_FAIL.test(raw)) {
        settle({
          status: 'auth_failure',
          exit_code: 3,
          message: 'authentication failure (token rejected by API)',
          elapsed_ms: elapsed,
          raw,
        });
        return;
      }
      if (RE_HEALTHY.test(raw)) {
        settle({
          status: 'healthy',
          exit_code: 0,
          message: `preflight ok (elapsed_ms=${elapsed})`,
          elapsed_ms: elapsed,
          raw,
        });
        return;
      }
      // Exit non-zero with no recognized banner → still unknown so wake
      // scripts can alert + fall through to next cycle without burning a
      // retry.
      settle({
        status: 'unknown',
        exit_code: 5,
        message: `preflight produced no recognized signal (claude exit=${code ?? 'null'})`,
        elapsed_ms: elapsed,
        raw,
      });
    });
  });
}

// Format a one-line stdout line wake scripts can grep deterministically.
// Schema: `PREFLIGHT status=<s> exit=<n> elapsed_ms=<n> [reset_iso=<iso>] [reset_banner="<...>"]`.
export function formatPreflightLine(r: PreflightDispatchResult): string {
  const parts = [
    `PREFLIGHT status=${r.status}`,
    `exit=${r.exit_code}`,
    `elapsed_ms=${r.elapsed_ms}`,
  ];
  if (r.reset_iso) parts.push(`reset_iso=${r.reset_iso}`);
  if (r.reset_banner) parts.push(`reset_banner="${r.reset_banner.replace(/"/g, '\\"')}"`);
  return parts.join(' ');
}
