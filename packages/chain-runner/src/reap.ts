// H-6 (chain-runner-battle-harden phase 6, 2026-05-14). Reap orphan worker
// processes — claude/bash children whose owning phase has since been marked
// done/blocked/failed but who failed to exit on their own. Companion to
// reports/chain_runner_hardening_plan_2026-05-14.md §H-6.
//
// Algorithm:
//   1. Snapshot `ps -axo pid,ppid,etime,command` (or accept an injected
//      snapshot for tests).
//   2. Filter for claude workers — `claude --permission-mode bypassPermissions
//      --print`.
//   3. For each candidate, walk the parent chain until we find a process whose
//      basename matches a known per-chain runner shell (table below). That
//      gives us the chain id + the phase id (the runner script is invoked as
//      `_chain_run_phase.sh PHASE_ID SESSION_ID PROMPT_FILE`).
//   4. Read that chain's state.json. If `phase_status[PHASE_ID].status !==
//      "in_progress"`, the claude process is an orphan.
//   5. SIGTERM, sleep grace, SIGKILL if still alive. Emit
//      `orphan_reaped(phase_id, pid, age_sec, command)` to the chain's audit
//      log (and a top-level reap.jsonl for cross-chain operator review).
//
// Safety: a live worker for an `in_progress` phase is NEVER reaped (the test
// suite has a fixture asserting this). Accidentally killing a live worker is
// the failure mode this module guards against.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { chainPaths, chainRoot } from './paths.js';
import { appendAudit } from './audit.js';
import { isoNow } from './time.js';
import type { StateFile } from './types.js';

export interface PsEntry {
  pid: number;
  ppid: number;
  /** Elapsed time as reported by ps (`MM:SS` or `HH:MM:SS` or `D-HH:MM:SS`). */
  etime: string;
  /** Full command including argv[0]; verbatim from `ps -axo command`. */
  command: string;
}

export interface OrphanSuspect {
  pid: number;
  ppid: number;
  command: string;
  ageSec: number;
  chainId: string;
  phaseId: number;
  runnerScript: string;
}

export interface OrphanFinding extends OrphanSuspect {
  /** Phase status read from state.json at scan time. */
  phaseStatus: string;
  /** True if `phaseStatus !== 'in_progress'` (the orphan condition). */
  isOrphan: boolean;
}

export interface ReapAction {
  pid: number;
  chainId: string;
  phaseId: number;
  /** What we did: `term` only, `kill` after grace, `already_gone`, `skipped_dry_run`, `error`. */
  outcome: 'term' | 'kill' | 'already_gone' | 'skipped_dry_run' | 'error';
  ageSec: number;
  command: string;
  /** Error message if outcome === 'error'. */
  error?: string;
}

export interface ReapReport {
  scannedAt: string;
  candidates: number;
  suspects: number;
  orphans: OrphanFinding[];
  /** Subset of `orphans` for which we attempted a reap (or noted dry-run). */
  actions: ReapAction[];
  dryRun: boolean;
}

/**
 * Per-chain runner shell basename → chain-id mapping. The mapping is
 * configurable via the `CAIA_REAP_RUNNER_MAP` env var (JSON
 * `{"basename": "chain-id"}`) so new chains can opt in without a code change.
 *
 * If a runner shell is observed whose basename is NOT in this table, it is
 * skipped (logged as an unknown-runner suspect rather than an orphan) — we'd
 * rather under-reap than kill a live worker for a chain we don't recognise.
 */
export const DEFAULT_RUNNER_MAP: Readonly<Record<string, string>> = Object.freeze({
  '_chain_harden_run_phase.sh': 'chain-runner-battle-harden',
  '_redflag_remediation_run_phase.sh': 'redflag-remediation',
  '_stability_completion_run_phase.sh': 'stability-completion',
  '_tier25_run_phase.sh': 'tier-2.5-local-real-traffic',
  '_a3_reliability_run_phase.sh': 'a3-reliability',
  '_local_ai_first_run_phase.sh': 'local-ai-first',
});

const CLAUDE_PATTERN = /claude\s+(?:.*\s)?--permission-mode\s+bypassPermissions\b.*--print\b/;

export function loadRunnerMap(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const merged: Record<string, string> = { ...DEFAULT_RUNNER_MAP };
  const raw = env['CAIA_REAP_RUNNER_MAP'];
  if (!raw) return merged;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v) merged[k] = v;
      }
    }
  } catch {
    // ignore malformed override — keep defaults
  }
  return merged;
}

/** Run `ps -axo pid,ppid,etime,command` and parse the output. */
export function snapshotPs(): PsEntry[] {
  const out = spawnSync('/bin/ps', ['-axo', 'pid,ppid,etime,command'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (out.status !== 0 || !out.stdout) return [];
  return parsePs(out.stdout);
}

/**
 * Parse `ps -axo pid,ppid,etime,command` output. First line is a header that
 * is discarded. Empty lines are skipped. Lines that don't parse cleanly (e.g.
 * kernel processes with odd formatting) are skipped.
 */
export function parsePs(raw: string): PsEntry[] {
  const lines = raw.split('\n');
  const out: PsEntry[] = [];
  let started = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!started) {
      // Skip the header row (contains "PID" and "COMMAND" labels).
      if (/^\s*PID\b/.test(line)) {
        started = true;
        continue;
      }
      // Some pseudo-terminals may emit ps without a header — fall through.
      started = true;
    }
    // ps fixed-width-ish: PID PPID ELAPSED COMMAND...
    // Use a permissive split on whitespace for the first 3 cols, then take the rest as command.
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const etime = m[3] ?? '';
    const command = (m[4] ?? '').trim();
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    out.push({ pid, ppid, etime, command });
  }
  return out;
}

/** Convert ps `etime` to seconds. Forms: `SS`, `MM:SS`, `HH:MM:SS`, `D-HH:MM:SS`. */
export function etimeToSeconds(etime: string): number {
  if (!etime) return 0;
  // D-HH:MM:SS
  const dMatch = /^(\d+)-(\d+):(\d+):(\d+)$/.exec(etime);
  if (dMatch) {
    const d = Number(dMatch[1]);
    const h = Number(dMatch[2]);
    const m = Number(dMatch[3]);
    const s = Number(dMatch[4]);
    return d * 86400 + h * 3600 + m * 60 + s;
  }
  const parts = etime.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  if (parts.length === 2) {
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  if (parts.length === 1) return parts[0] ?? 0;
  return 0;
}

/**
 * Walk the parent chain from `pid` until we find a process whose command
 * basename matches a known runner-shell entry. Returns the runner entry
 * (which carries chain id + the phase id from its argv) or null.
 *
 * We bound the walk at 32 hops to defend against pathological cycles (which
 * shouldn't exist on a sane system but ps + corrupted state could lie).
 */
export function findRunnerAncestor(
  pid: number,
  byPid: Map<number, PsEntry>,
  runnerMap: Record<string, string>,
): { entry: PsEntry; chainId: string; phaseId: number; runnerScript: string } | null {
  let current = byPid.get(pid);
  let hops = 0;
  while (current && hops < 32) {
    const match = matchRunner(current.command, runnerMap);
    if (match) {
      return {
        entry: current,
        chainId: match.chainId,
        phaseId: match.phaseId,
        runnerScript: match.runnerScript,
      };
    }
    if (current.ppid <= 1 || current.ppid === current.pid) return null;
    current = byPid.get(current.ppid);
    hops += 1;
  }
  return null;
}

/**
 * Match a command line against the runner-map. Looks for any token in the
 * command whose basename appears in the map. Returns the chain id + parsed
 * phase id from the runner script's first positional arg, or null.
 */
function matchRunner(
  command: string,
  runnerMap: Record<string, string>,
): { chainId: string; phaseId: number; runnerScript: string } | null {
  // Tokenise on whitespace. `bash _foo_run_phase.sh 7 sess123 prompt.txt`
  // or `/usr/bin/env bash /abs/_foo_run_phase.sh 7 ...` — find the first
  // token whose basename is in the runner map and treat the *next* token as
  // the phase id.
  const tokens = command.split(/\s+/).filter((t) => t.length > 0);
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i] ?? '';
    const bn = basename(tok);
    const chainId = runnerMap[bn];
    if (!chainId) continue;
    const phaseTok = tokens[i + 1] ?? '';
    const phaseId = Number(phaseTok);
    if (!Number.isInteger(phaseId) || phaseId < 0) return null;
    return { chainId, phaseId, runnerScript: bn };
  }
  return null;
}

export interface ReapOptions {
  dryRun?: boolean;
  /** Restrict the scan to a single chain id. */
  chainId?: string;
  /** Inject a ps snapshot for tests. When set, `snapshotPs()` is NOT called. */
  psSnapshot?: PsEntry[];
  /** Inject the runner map (overrides DEFAULT_RUNNER_MAP + env). */
  runnerMap?: Record<string, string>;
  /** Inject a state reader for tests; defaults to reading from disk. */
  readState?: (chainId: string) => StateFile | null;
  /** Inject a killer for tests. Returns true if the process was alive after
   *  the signal (i.e., still present and needs a stronger signal). */
  kill?: (pid: number, signal: NodeJS.Signals) => 'sent' | 'esrch' | 'eperm' | 'err';
  /** Inject a probe — returns true if the pid is still alive. */
  isAlive?: (pid: number) => boolean;
  /** Grace period between SIGTERM and SIGKILL, ms. Default 10_000. */
  termGraceMs?: number;
  /** Sleep impl, for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Audit file appender override, for tests. */
  appendAuditFn?: typeof appendAudit;
  /** Top-level reap log path. Set to null to disable. */
  reapLogPath?: string | null;
}

const DEFAULT_TERM_GRACE_MS = 10_000;

export function defaultReadState(chainId: string): StateFile | null {
  try {
    const paths = chainPaths(chainId);
    if (!existsSync(paths.stateFile)) return null;
    return JSON.parse(readFileSync(paths.stateFile, 'utf8')) as StateFile;
  } catch {
    return null;
  }
}

function defaultKill(
  pid: number,
  signal: NodeJS.Signals,
): 'sent' | 'esrch' | 'eperm' | 'err' {
  try {
    process.kill(pid, signal);
    return 'sent';
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ESRCH') return 'esrch';
    if (code === 'EPERM') return 'eperm';
    return 'err';
  }
}

function defaultIsAlive(pid: number): boolean {
  try {
    // signal 0 = existence check
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'EPERM') return true; // exists, just not ours
    return false;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Find orphan workers and (unless dryRun) reap them. Always returns the full
 * scan report so doctor can surface counts.
 */
export async function reapOrphans(opts: ReapOptions = {}): Promise<ReapReport> {
  const dryRun = opts.dryRun ?? false;
  const psSnapshot = opts.psSnapshot ?? snapshotPs();
  const runnerMap = opts.runnerMap ?? loadRunnerMap();
  const readState = opts.readState ?? defaultReadState;
  const kill = opts.kill ?? defaultKill;
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const sleep = opts.sleep ?? defaultSleep;
  const auditFn = opts.appendAuditFn ?? appendAudit;
  const termGraceMs = opts.termGraceMs ?? DEFAULT_TERM_GRACE_MS;
  const reapLogPath =
    opts.reapLogPath === undefined
      ? join(chainRoot(), '..', 'chain-watchdog', 'reap.jsonl')
      : opts.reapLogPath;

  const byPid = new Map<number, PsEntry>();
  for (const e of psSnapshot) byPid.set(e.pid, e);

  // Step 2 — filter claude workers.
  const candidates = psSnapshot.filter((e) => CLAUDE_PATTERN.test(e.command));

  // Step 3 — find runner ancestor + chain/phase.
  const suspects: OrphanSuspect[] = [];
  for (const c of candidates) {
    const anc = findRunnerAncestor(c.pid, byPid, runnerMap);
    if (!anc) continue;
    if (opts.chainId && anc.chainId !== opts.chainId) continue;
    suspects.push({
      pid: c.pid,
      ppid: c.ppid,
      command: c.command,
      ageSec: etimeToSeconds(c.etime),
      chainId: anc.chainId,
      phaseId: anc.phaseId,
      runnerScript: anc.runnerScript,
    });
  }

  // Step 4 — read state and classify.
  const orphans: OrphanFinding[] = [];
  // Cache state per chain so we don't re-read state.json N times.
  const stateCache = new Map<string, StateFile | null>();
  for (const s of suspects) {
    let state = stateCache.get(s.chainId);
    if (state === undefined) {
      state = readState(s.chainId);
      stateCache.set(s.chainId, state);
    }
    let phaseStatus = 'unknown';
    if (state && state.phase_status) {
      const ps = state.phase_status[String(s.phaseId)];
      if (ps && typeof ps.status === 'string') phaseStatus = ps.status;
    }
    const isOrphan = phaseStatus !== 'in_progress';
    orphans.push({ ...s, phaseStatus, isOrphan });
  }

  // Step 5 — reap.
  const actions: ReapAction[] = [];
  for (const o of orphans) {
    if (!o.isOrphan) continue;
    if (dryRun) {
      actions.push({
        pid: o.pid,
        chainId: o.chainId,
        phaseId: o.phaseId,
        outcome: 'skipped_dry_run',
        ageSec: o.ageSec,
        command: o.command,
      });
      continue;
    }
    const action = await reapOne(o, kill, isAlive, sleep, termGraceMs);
    actions.push(action);
    // Emit per-chain audit + top-level reap log
    try {
      const paths = chainPaths(o.chainId);
      auditFn(paths.auditFile, 'orphan_reaped', {
        phase_id: o.phaseId,
        pid: o.pid,
        age_sec: o.ageSec,
        command: o.command.slice(0, 500),
        outcome: action.outcome,
      });
    } catch {
      // best effort — never let an audit-write failure mask a successful kill
    }
    if (reapLogPath) {
      try {
        mkdirSync(join(reapLogPath, '..'), { recursive: true });
        appendFileSync(
          reapLogPath,
          JSON.stringify({
            ts: isoNow(),
            chain: o.chainId,
            phase_id: o.phaseId,
            pid: o.pid,
            age_sec: o.ageSec,
            outcome: action.outcome,
            command: o.command.slice(0, 500),
          }) + '\n',
          { mode: 0o600 },
        );
      } catch {
        // ignore
      }
    }
  }

  return {
    scannedAt: isoNow(),
    candidates: candidates.length,
    suspects: suspects.length,
    orphans,
    actions,
    dryRun,
  };
}

async function reapOne(
  orphan: OrphanFinding,
  kill: NonNullable<ReapOptions['kill']>,
  isAlive: NonNullable<ReapOptions['isAlive']>,
  sleep: NonNullable<ReapOptions['sleep']>,
  termGraceMs: number,
): Promise<ReapAction> {
  const base = {
    pid: orphan.pid,
    chainId: orphan.chainId,
    phaseId: orphan.phaseId,
    ageSec: orphan.ageSec,
    command: orphan.command,
  };
  const termOutcome = kill(orphan.pid, 'SIGTERM');
  if (termOutcome === 'esrch') {
    return { ...base, outcome: 'already_gone' };
  }
  if (termOutcome === 'err' || termOutcome === 'eperm') {
    return { ...base, outcome: 'error', error: `SIGTERM ${termOutcome}` };
  }
  await sleep(termGraceMs);
  if (!isAlive(orphan.pid)) {
    return { ...base, outcome: 'term' };
  }
  const killOutcome = kill(orphan.pid, 'SIGKILL');
  if (killOutcome === 'esrch') {
    return { ...base, outcome: 'term' };
  }
  if (killOutcome === 'err' || killOutcome === 'eperm') {
    return { ...base, outcome: 'error', error: `SIGKILL ${killOutcome}` };
  }
  return { ...base, outcome: 'kill' };
}

/**
 * Convenience formatter for the doctor section / CLI text output.
 */
export function formatReapReport(r: ReapReport): string {
  const lines: string[] = [];
  lines.push(
    `scanned_at=${r.scannedAt} candidates=${r.candidates} suspects=${r.suspects} orphans=${r.orphans.filter((o) => o.isOrphan).length} dry_run=${r.dryRun}`,
  );
  for (const o of r.orphans) {
    lines.push(
      `  pid=${o.pid} chain=${o.chainId} phase=${o.phaseId} status=${o.phaseStatus} age_sec=${o.ageSec} orphan=${o.isOrphan}`,
    );
  }
  for (const a of r.actions) {
    lines.push(
      `  action pid=${a.pid} chain=${a.chainId} phase=${a.phaseId} outcome=${a.outcome}${a.error ? ` error=${a.error}` : ''}`,
    );
  }
  return lines.join('\n');
}

/** Resolve the default top-level chain-watchdog reap log path. Exported for tests. */
export function defaultReapLogPath(): string {
  return join(homedir(), '.caia', 'chain-watchdog', 'reap.jsonl');
}
