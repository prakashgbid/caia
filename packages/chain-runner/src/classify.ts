import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isoNow } from './time.js';
import { findPhase } from './spec.js';
import type { StateContext } from './state.js';
import type { FailureClass, LockFile, PhaseFailure } from './types.js';

// H-1 (chain-runner-battle-harden phase 2, 2026-05-14). Classifies a stale
// worker into a FailureClass by sniffing its dispatch log + checking artifact
// presence. Maps to gap-analysis §1.1 F-01..F-15 and the three overnight
// incidents documented in reports/overnight_incidents_2026-05-14.md:
//   - incident #1 (phase 3 hang after artifact write) → worker_hung_post_success
//   - incident #2 (phase 7 rate-limit at spawn) → worker_no_start_rate_limit
//   - incident #3 (silent stall variant) → worker_hung_mid_work

const LOG_SNIFF_MAX_BYTES = 256 * 1024;

// Patterns keyed by failure class. Order matters: rate-limit first because
// the limit banner is the most specific (and is the literal string the
// claude CLI prints on cap exhaustion).
const LOG_PATTERNS: Array<{
  class: FailureClass;
  pattern: RegExp;
  describe: (m: RegExpExecArray) => string;
}> = [
  {
    class: 'worker_no_start_rate_limit',
    pattern: /You(?:'|’)ve hit your limit(?:[^\n]*?resets ([^\n]+))?/i,
    describe: (m) => {
      const reset = m[1]?.trim();
      return reset
        ? `rate limit hit; resets ${reset}`
        : 'rate limit hit (no reset time captured)';
    },
  },
  {
    class: 'worker_no_start_auth_failure',
    pattern:
      /Invalid authentication credentials|API Error 401|Unauthorized: invalid (?:api )?key|authentication_error/i,
    describe: () => 'authentication failure (token rejected by API)',
  },
  {
    class: 'worker_no_start_binary_missing',
    pattern:
      /command not found|claude: No such file|No such file or directory.*claude|ENOENT.*claude/i,
    describe: () => 'claude binary missing or not on PATH',
  },
  {
    class: 'worker_no_start_spawn_error',
    pattern:
      /EACCES|EPERM|spawn\s+\S+\s+(?:EACCES|EPERM|ENOMEM)|cannot allocate memory/i,
    describe: () => 'spawn failed (permission denied / resource error)',
  },
  {
    class: 'worker_no_start_bad_args',
    pattern:
      /unknown option|unrecognized option|invalid argument|usage:\s+claude/i,
    describe: () => 'bad CLI args passed to claude',
  },
  {
    class: 'worker_crashed',
    pattern:
      /Segmentation fault|core dumped|FATAL:|Uncaught (?:Exception|Error)|panic:|signal\s+(?:SIGSEGV|SIGBUS|SIGABRT)/i,
    describe: () => 'worker crashed (fatal signal or uncaught exception)',
  },
];

interface ResolvedSuccessCriteria {
  output_file: string | undefined;
  min_bytes: number;
  grep_match: string | undefined;
}

function resolveSuccessCriteria(
  ctx: StateContext,
  phaseId: number,
): ResolvedSuccessCriteria | null {
  let phase;
  try {
    phase = findPhase(ctx.spec, phaseId);
  } catch {
    return null;
  }
  const sc = (phase.success_criteria ?? {}) as Record<string, unknown>;
  const output = typeof sc.output_file === 'string' ? sc.output_file : undefined;
  const min = typeof sc.min_bytes === 'number' ? sc.min_bytes : 0;
  const grep = typeof sc.grep_match === 'string' ? sc.grep_match : undefined;
  return { output_file: output, min_bytes: min, grep_match: grep };
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) return join(process.env['HOME'] ?? '', p.slice(2));
  return p;
}

function readLogTail(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return null;
    const size = stat.size;
    const buf = readFileSync(path);
    if (size <= LOG_SNIFF_MAX_BYTES) return buf.toString('utf8');
    return buf.subarray(size - LOG_SNIFF_MAX_BYTES).toString('utf8');
  } catch {
    return null;
  }
}

export interface ArtifactCheck {
  exists: boolean;
  size_bytes: number;
  meets_min_bytes: boolean;
  grep_matched: boolean | null; // null = no grep_match configured
  path: string | null;
}

export function checkArtifact(
  ctx: StateContext,
  phaseId: number,
): ArtifactCheck {
  const sc = resolveSuccessCriteria(ctx, phaseId);
  if (!sc || !sc.output_file) {
    return {
      exists: false,
      size_bytes: 0,
      meets_min_bytes: false,
      grep_matched: null,
      path: null,
    };
  }
  const path = expandHome(sc.output_file);
  if (!existsSync(path)) {
    return {
      exists: false,
      size_bytes: 0,
      meets_min_bytes: false,
      grep_matched: null,
      path,
    };
  }
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    size = 0;
  }
  const meets = size >= (sc.min_bytes ?? 0);
  let grepMatched: boolean | null = null;
  if (sc.grep_match) {
    try {
      const body = readFileSync(path, 'utf8');
      grepMatched = new RegExp(sc.grep_match).test(body);
    } catch {
      grepMatched = false;
    }
  }
  return {
    exists: true,
    size_bytes: size,
    meets_min_bytes: meets,
    grep_matched: grepMatched,
    path,
  };
}

export function sniffLogForClass(logPath?: string | null): {
  match: { class: FailureClass; reason: string; matched_text: string } | null;
  log_sampled: boolean;
} {
  if (!logPath) return { match: null, log_sampled: false };
  const body = readLogTail(logPath);
  if (body === null) return { match: null, log_sampled: false };
  for (const p of LOG_PATTERNS) {
    const m = p.pattern.exec(body);
    if (m) {
      return {
        match: {
          class: p.class,
          reason: p.describe(m),
          matched_text: m[0].slice(0, 200),
        },
        log_sampled: true,
      };
    }
  }
  return { match: null, log_sampled: true };
}

// Primary entry-point: classify a stale lock event into a structured
// PhaseFailure. Inputs: chain context, the lock at the moment of detection,
// and optionally an explicit dispatch-log path. When the path is omitted,
// the classifier still produces a class via artifact-presence and timing
// signals (worker_hung_post_success if the artifact landed; worker_hung_mid_work
// if heartbeat aged out without progress; runtime_exceeded if the cap tripped).
export interface ClassifyStaleLockOptions {
  /** Optional dispatch log path. If unset, only artifact + lock evidence is used. */
  dispatchLogPath?: string | null;
  /** Indicates the staleness path that triggered classification. */
  trigger?: 'heartbeat' | 'timeout';
  /** Observed heartbeat age in seconds at detection (purely evidence). */
  hb_age_sec?: number;
  /** Observed runtime in seconds at detection (purely evidence). */
  run_sec?: number;
  /** Cap in seconds. */
  cap_sec?: number;
}

export function classifyStaleLock(
  ctx: StateContext,
  lock: LockFile,
  opts: ClassifyStaleLockOptions = {},
): PhaseFailure {
  const evidence: Record<string, unknown> = {
    phase_id: lock.phase_id,
    session_id: lock.session_id,
    trigger: opts.trigger ?? 'heartbeat',
  };
  if (typeof opts.hb_age_sec === 'number') {
    evidence['hb_age_sec'] = Math.floor(opts.hb_age_sec);
  }
  if (typeof opts.run_sec === 'number') {
    evidence['run_sec'] = Math.floor(opts.run_sec);
  }
  if (typeof opts.cap_sec === 'number') {
    evidence['cap_sec'] = opts.cap_sec;
  }
  if (opts.dispatchLogPath) {
    evidence['dispatch_log'] = opts.dispatchLogPath;
  }

  // (1) Sniff the worker's log first — covers F-01..F-04 (rate limit, auth,
  // binary missing, spawn error, crash). These dominate the "worker never ran"
  // bucket.
  const sniffed = sniffLogForClass(opts.dispatchLogPath ?? null);
  evidence['log_sampled'] = sniffed.log_sampled;
  if (sniffed.match) {
    evidence['matched_text'] = sniffed.match.matched_text;
    return {
      class: sniffed.match.class,
      reason: sniffed.match.reason,
      detected_at: isoNow(),
      evidence,
    };
  }

  // (2) Runtime cap tripped — explicit timeout. The lock.ts caller passes
  // trigger='timeout' for this branch.
  if (opts.trigger === 'timeout') {
    return {
      class: 'runtime_exceeded',
      reason: `runtime cap exceeded run_sec=${Math.floor(
        opts.run_sec ?? 0,
      )} cap_sec=${opts.cap_sec ?? 0}`,
      detected_at: isoNow(),
      evidence,
    };
  }

  // (3) Heartbeat aged out but the artifact landed → the canonical "hung
  // after success" pattern from incident #1.
  const art = checkArtifact(ctx, lock.phase_id);
  evidence['artifact'] = {
    exists: art.exists,
    size_bytes: art.size_bytes,
    meets_min_bytes: art.meets_min_bytes,
    grep_matched: art.grep_matched,
    path: art.path,
  };
  if (art.exists && art.meets_min_bytes && art.grep_matched !== false) {
    return {
      class: 'worker_hung_post_success',
      reason:
        'heartbeat stale but artifact validates success_criteria — worker hung after writing deliverable',
      detected_at: isoNow(),
      evidence,
    };
  }

  // (4) Heartbeat aged out with no artifact and no log signal → mid-work hang.
  // Distinguished from `unknown` by the heartbeat-trigger; `unknown` is the
  // fallback when we have neither evidence.
  if (
    opts.trigger === 'heartbeat' &&
    typeof opts.hb_age_sec === 'number' &&
    opts.hb_age_sec > 0
  ) {
    return {
      class: 'worker_hung_mid_work',
      reason: `heartbeat aged out (${Math.floor(
        opts.hb_age_sec,
      )}s) with no artifact and no log signal`,
      detected_at: isoNow(),
      evidence,
    };
  }

  return {
    class: 'unknown',
    reason: 'no log signal, no artifact, no timing evidence',
    detected_at: isoNow(),
    evidence,
  };
}

// Helper: construct a PhaseFailure from a free-form reason string for the
// back-compat shim in state.markFailed.
export function failureFromReason(reason: string): PhaseFailure {
  return {
    class: 'unknown',
    reason: reason.slice(0, 500),
    detected_at: isoNow(),
    evidence: { legacy_string_reason: true },
  };
}
