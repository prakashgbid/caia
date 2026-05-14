// `caia-chain doctor` — operator-friendly health snapshot.
//
// V1 sections (original):
//   1. node version (which interpreter caia-chain itself is running under)
//   2. healthz of mentor (5180) + local-llm-router (7411)
//   3. launchctl print state of each known plist (label + state + last_exit_status)
//   4. last_wake of each chain under ~/.caia/chain/*/state.json
//
// V2 sections (H-7, chain-runner-battle-harden phase 6, 2026-05-14):
//   5. chains: phase counts by status + lock age + NONE_ELIGIBLE streak +
//      last successful phase_done timestamp (read from audit.jsonl).
//   6. orphans: reapOrphans(dryRun=true) summary.
//   7. disk: free space on / and $TMPDIR; if either < 5 GB doctor exits 1.
//   8. auth: preflightDispatch result (subscription quota + auth liveness).
//   9. quota: most-imminent rate-limit reset banner scraped from recent
//      dispatch logs across all chains.
//
// Exit codes:
//   0 healthy
//   1 degraded (healthz fail, low disk, preflight non-zero, etc.)
//   2 stalled-chain (any chain has phase counts that look stuck — none_eligible
//     streak >= 2 or lock_age_sec > 3h)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_HEALTHZ_ENDPOINTS,
  checkHealthzAll,
  type HealthzCheckResult,
} from './bootstrap.js';
import { reapOrphans, type ReapReport } from './reap.js';
import {
  parseResetIsoFromBanner,
  preflightDispatch,
  type PreflightDispatchResult,
} from './preflight.js';
import type { PhaseState, StateFile } from './types.js';

/**
 * Known LaunchAgent labels managed by the CAIA stack. Doctor calls
 * `launchctl print gui/<uid>/<label>` on each; missing labels are
 * reported as "not_loaded" but do not fail the doctor (the operator
 * may have intentionally unloaded one).
 */
export const KNOWN_PLIST_LABELS: readonly string[] = [
  'com.caia.chain-watchdog',
  'com.caia.handoff-refresh-hourly',
  'com.caia.hygiene-audit-daily',
  'com.caia.mentor.memory-watcher',
  'com.caia.mentor.server',
  'com.caia.pr-drainer-hourly',
  'com.caia.redflag-wake',
  'com.caia.stability-completion-wake',
  'com.caia.tier25-wake',
  'com.chiefaia.apprentice-corpus',
  'com.chiefaia.apprentice-corpus-heartbeat',
  'com.chiefaia.apprentice-retrainer',
  'com.chiefaia.local-llm-router',
  'com.chiefaia.sps-audit-recent-done-hourly',
];

/** Disk-free threshold (KB). doctor degrades to exit 1 below this. */
export const DISK_FREE_DEGRADE_KB = 5 * 1024 * 1024; // 5 GB

/** A chain's lock is considered too-old past this many seconds (3 x grace). */
export const LOCK_AGE_STALLED_SEC = 3 * 3600;

/** none_eligible_streak >= this counts as stalled. */
export const NONE_ELIGIBLE_STALLED_STREAK = 2;

/** Quota-section log scan: window for "recent" dispatch logs (ms). */
export const QUOTA_SCAN_WINDOW_MS = 24 * 3600 * 1000;

export interface PlistState {
  label: string;
  loaded: boolean;
  state: string | null;
  lastExitStatus: number | null;
  raw: string;
}

export interface ChainWakeState {
  chainId: string;
  lastWake: string | null;
  currentPhase: number | null;
  paused: boolean | null;
  allDone: boolean | null;
}

export interface ChainHealth {
  chainId: string;
  /** Phase counts by status. */
  counts: Record<string, number>;
  /** Age of the active lock file in seconds (null if no lock). */
  lockAgeSec: number | null;
  /** Active lock phase id, if any. */
  lockedPhase: number | null;
  /** None-eligible streak from state.json (0 if missing). */
  noneEligibleStreak: number;
  /** Timestamp of the most recent `phase_done` audit event. */
  lastPhaseDone: string | null;
  /** True if this chain is stalled (none_eligible_streak high, or lock too old). */
  stalled: boolean;
  paused: boolean;
  pausedUntil: string | null;
}

export interface DiskCheck {
  mount: string;
  /** Free KB (df -k Avail column). */
  availKb: number;
  total: number;
  ok: boolean;
}

export interface QuotaWarning {
  chainId: string;
  logPath: string;
  resetIso: string | null;
  banner: string;
  detectedAt: string;
}

export interface DoctorReport {
  nodeVersion: string;
  nodeBin: string;
  healthz: HealthzCheckResult[];
  plists: PlistState[];
  chains: ChainWakeState[];
  // V2 additions — optional in JSON so older tooling consuming the report
  // doesn't break. Always present when produced by runDoctor in v2 mode.
  chainHealth?: ChainHealth[];
  orphans?: ReapReport;
  disk?: DiskCheck[];
  auth?: PreflightDispatchResult | { status: 'skipped'; message: string };
  quota?: QuotaWarning[];
}

function runLaunchctlPrint(label: string, uid: number): string {
  const out = spawnSync('/bin/launchctl', ['print', `gui/${uid}/${label}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (out.status !== 0) return '';
  return out.stdout ?? '';
}

export function parseLaunchctlPrint(raw: string): {
  state: string | null;
  lastExitStatus: number | null;
} {
  if (!raw) return { state: null, lastExitStatus: null };
  let state: string | null = null;
  let lastExitStatus: number | null = null;
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (state === null && s.startsWith('state ')) {
      const m = /state\s*=\s*(.+)$/.exec(s);
      if (m && m[1]) state = m[1].trim();
    }
    if (lastExitStatus === null) {
      const m =
        /last exit (?:status|code)\s*=\s*(-?\d+)/.exec(s) ??
        /last exit reason\s*=\s*(-?\d+)/.exec(s);
      if (m && m[1]) lastExitStatus = Number(m[1]);
    }
  }
  return { state, lastExitStatus };
}

export function inspectPlist(label: string, uid: number = process.getuid?.() ?? 501): PlistState {
  const raw = runLaunchctlPrint(label, uid);
  const loaded = raw.length > 0;
  const parsed = parseLaunchctlPrint(raw);
  return {
    label,
    loaded,
    state: parsed.state,
    lastExitStatus: parsed.lastExitStatus,
    raw,
  };
}

export function readChainWakes(chainRoot: string = join(homedir(), '.caia', 'chain')): ChainWakeState[] {
  if (!existsSync(chainRoot)) return [];
  const out: ChainWakeState[] = [];
  let entries: string[];
  try {
    entries = readdirSync(chainRoot);
  } catch {
    return [];
  }
  for (const name of entries) {
    const dir = join(chainRoot, name);
    let isDir: boolean;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const stateFile = join(dir, 'state.json');
    if (!existsSync(stateFile)) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    } catch {
      out.push({
        chainId: name,
        lastWake: null,
        currentPhase: null,
        paused: null,
        allDone: null,
      });
      continue;
    }
    out.push({
      chainId: name,
      lastWake: (parsed['last_wake'] as string | null | undefined) ?? null,
      currentPhase:
        typeof parsed['current_phase'] === 'number'
          ? (parsed['current_phase'] as number)
          : null,
      paused: typeof parsed['paused'] === 'boolean' ? (parsed['paused'] as boolean) : null,
      allDone:
        typeof parsed['all_done'] === 'boolean' ? (parsed['all_done'] as boolean) : null,
    });
  }
  out.sort((a, b) => a.chainId.localeCompare(b.chainId));
  return out;
}

/** Walk a state.json into the per-status counts + stall heuristics. */
export function summariseChainHealth(
  chainId: string,
  state: StateFile | null,
  lockMtimeMs: number | null,
  lockedPhase: number | null,
  lastPhaseDone: string | null,
  nowMs: number = Date.now(),
): ChainHealth {
  const counts: Record<string, number> = {};
  if (state?.phase_status) {
    for (const p of Object.values(state.phase_status) as PhaseState[]) {
      counts[p.status] = (counts[p.status] ?? 0) + 1;
    }
  }
  const lockAgeSec =
    lockMtimeMs === null ? null : Math.max(0, Math.floor((nowMs - lockMtimeMs) / 1000));
  const noneEligibleStreak = state?.none_eligible_streak ?? 0;
  const stalled =
    noneEligibleStreak >= NONE_ELIGIBLE_STALLED_STREAK ||
    (lockAgeSec !== null && lockAgeSec > LOCK_AGE_STALLED_SEC);
  return {
    chainId,
    counts,
    lockAgeSec,
    lockedPhase,
    noneEligibleStreak,
    lastPhaseDone,
    stalled,
    paused: state?.paused ?? false,
    pausedUntil: state?.paused_until ?? null,
  };
}

/** Find the most recent `phase_done` event in audit.jsonl. Returns its ts or null. */
export function lastPhaseDoneTs(auditFile: string): string | null {
  if (!existsSync(auditFile)) return null;
  let raw: string;
  try {
    raw = readFileSync(auditFile, 'utf8');
  } catch {
    return null;
  }
  // Walk lines from end → start so we find the most-recent event quickly.
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    // Cheap pre-filter to avoid JSON.parse cost.
    if (!line.includes('"phase_done"')) continue;
    try {
      const ev = JSON.parse(line) as { event?: string; ts?: string };
      if (ev.event === 'phase_done' && typeof ev.ts === 'string') return ev.ts;
    } catch {
      // continue
    }
  }
  return null;
}

export function readChainHealth(
  chainRoot: string = join(homedir(), '.caia', 'chain'),
  nowMs: number = Date.now(),
): ChainHealth[] {
  if (!existsSync(chainRoot)) return [];
  const out: ChainHealth[] = [];
  let entries: string[];
  try {
    entries = readdirSync(chainRoot);
  } catch {
    return [];
  }
  for (const name of entries) {
    const dir = join(chainRoot, name);
    let isDir: boolean;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const stateFile = join(dir, 'state.json');
    if (!existsSync(stateFile)) continue;
    let state: StateFile | null;
    try {
      state = JSON.parse(readFileSync(stateFile, 'utf8')) as StateFile;
    } catch {
      state = null;
    }
    const lockFile = join(dir, 'lock.json');
    let lockMtimeMs: number | null = null;
    let lockedPhase: number | null = null;
    if (existsSync(lockFile)) {
      try {
        const st = statSync(lockFile);
        lockMtimeMs = st.mtimeMs;
        const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { phase_id?: number };
        if (typeof lock.phase_id === 'number') lockedPhase = lock.phase_id;
      } catch {
        // ignore
      }
    }
    const auditFile = join(dir, 'audit.jsonl');
    const lastDone = lastPhaseDoneTs(auditFile);
    out.push(summariseChainHealth(name, state, lockMtimeMs, lockedPhase, lastDone, nowMs));
  }
  out.sort((a, b) => a.chainId.localeCompare(b.chainId));
  return out;
}

/** Check free space on the given mount via `df -k`. */
export function checkDiskFree(mount: string): DiskCheck {
  const out = spawnSync('/bin/df', ['-k', mount], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (out.status !== 0 || !out.stdout) {
    return { mount, availKb: 0, total: 0, ok: false };
  }
  return parseDfOutput(mount, out.stdout);
}

export function parseDfOutput(mount: string, raw: string): DiskCheck {
  // df -k: Filesystem 1024-blocks Used Available Capacity ... Mounted on
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { mount, availKb: 0, total: 0, ok: false };
  const dataLine = lines[lines.length - 1] ?? '';
  const parts = dataLine.split(/\s+/);
  const nums = parts.filter((p) => /^\d+$/.test(p)).map((p) => Number(p));
  if (nums.length < 3) return { mount, availKb: 0, total: 0, ok: false };
  const total = nums[0] ?? 0;
  // Avail is third numeric column on macOS (1024-blocks, Used, Avail).
  const availKb = nums[2] ?? 0;
  return { mount, availKb, total, ok: availKb >= DISK_FREE_DEGRADE_KB };
}

/**
 * Scrape per-chain dispatch logs for rate-limit banners. Returns one warning
 * per chain whose most-recent banner has a future reset ISO. Sorted by
 * `resetIso` ascending so the most-imminent reset is the first element.
 */
export function scanQuotaWarnings(
  chainRoot: string = join(homedir(), '.caia', 'chain'),
  nowMs: number = Date.now(),
  watchdogLogs: string = join(homedir(), '.caia', 'chain-watchdog', 'logs'),
): QuotaWarning[] {
  const out: QuotaWarning[] = [];
  const seenChains = new Set<string>();
  const collect = (chainId: string, logPath: string): void => {
    try {
      const st = statSync(logPath);
      if (nowMs - st.mtimeMs > QUOTA_SCAN_WINDOW_MS) return;
      const raw = readFileSync(logPath, 'utf8');
      if (!/hit your limit|limit/i.test(raw)) return;
      const parsed = parseResetIsoFromBanner(raw, nowMs);
      if (!parsed.matched) return;
      if (seenChains.has(chainId)) return;
      seenChains.add(chainId);
      out.push({
        chainId,
        logPath,
        resetIso: parsed.iso,
        banner: parsed.matched,
        detectedAt: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      });
    } catch {
      // ignore unreadable logs
    }
  };
  if (existsSync(chainRoot)) {
    let entries: string[];
    try {
      entries = readdirSync(chainRoot);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      const dir = join(chainRoot, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      let files: string[];
      try {
        files = readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.startsWith('dispatch-') || !f.endsWith('.log')) continue;
        collect(name, join(dir, f));
      }
    }
  }
  if (existsSync(watchdogLogs)) {
    let files: string[];
    try {
      files = readdirSync(watchdogLogs);
    } catch {
      files = [];
    }
    for (const f of files) {
      if (!f.startsWith('preflight_') || !f.endsWith('.log')) continue;
      const m = /^preflight_(.+?)_\d{4}-\d{2}-\d{2}\.log$/.exec(f);
      const chainId = m && m[1] ? m[1] : f;
      collect(chainId, join(watchdogLogs, f));
    }
  }
  out.sort((a, b) => {
    const ai = a.resetIso ?? '';
    const bi = b.resetIso ?? '';
    return ai.localeCompare(bi);
  });
  return out;
}

export interface RunDoctorOptions {
  uid?: number;
  chainRoot?: string;
  healthzTimeoutMs?: number;
  plistLabels?: readonly string[];
  /** Skip the V2 sections (faster path used by old callers). Default false. */
  legacyOnly?: boolean;
  /** Skip the auth preflight (it spawns claude — slow). Default false. */
  skipAuth?: boolean;
  /** Override mounts checked in disk section. */
  diskMounts?: string[];
  /** Inject a clock for tests. */
  nowMs?: number;
  /** Inject a reapOrphans fn for tests. */
  reapFn?: typeof reapOrphans;
  /** Inject a preflight fn for tests. */
  preflightFn?: typeof preflightDispatch;
  /** Inject a disk-check fn for tests. */
  diskFn?: typeof checkDiskFree;
  /** Inject a quota scanner for tests. */
  quotaFn?: typeof scanQuotaWarnings;
  /** Watchdog log dir (for quota scan). */
  watchdogLogs?: string;
}

export async function runDoctor(opts: RunDoctorOptions = {}): Promise<DoctorReport> {
  const uid = opts.uid ?? process.getuid?.() ?? 501;
  const labels = opts.plistLabels ?? KNOWN_PLIST_LABELS;
  const healthz = await checkHealthzAll(DEFAULT_HEALTHZ_ENDPOINTS, {
    timeoutMs: opts.healthzTimeoutMs ?? 2_000,
  });
  const plists = labels.map((l) => inspectPlist(l, uid));
  const chains = readChainWakes(opts.chainRoot);
  const report: DoctorReport = {
    nodeVersion: process.version,
    nodeBin: process.execPath,
    healthz,
    plists,
    chains,
  };
  if (opts.legacyOnly) return report;

  const nowMs = opts.nowMs ?? Date.now();

  // 5. chain section
  report.chainHealth = readChainHealth(opts.chainRoot, nowMs);

  // 6. orphans section (always dry-run from doctor)
  const reapFn = opts.reapFn ?? reapOrphans;
  try {
    report.orphans = await reapFn({ dryRun: true });
  } catch (err) {
    report.orphans = {
      scannedAt: new Date(nowMs).toISOString(),
      candidates: 0,
      suspects: 0,
      orphans: [],
      actions: [],
      dryRun: true,
    };
    (report.orphans as ReapReport & { _error?: string })._error = (err as Error).message;
  }

  // 7. disk section
  const diskFn = opts.diskFn ?? checkDiskFree;
  const mounts = opts.diskMounts ?? ['/', process.env['TMPDIR'] ?? tmpdir()];
  report.disk = mounts.map((m) => diskFn(m));

  // 8. auth section (skippable — preflight spawns claude which is slow)
  if (!opts.skipAuth) {
    const preflightFn = opts.preflightFn ?? preflightDispatch;
    try {
      report.auth = await preflightFn({ timeoutMs: 15_000 });
    } catch (err) {
      report.auth = { status: 'skipped', message: `preflight error: ${(err as Error).message}` };
    }
  } else {
    report.auth = { status: 'skipped', message: 'skipped via --skip-auth' };
  }

  // 9. quota section
  const quotaFn = opts.quotaFn ?? scanQuotaWarnings;
  report.quota = quotaFn(opts.chainRoot, nowMs, opts.watchdogLogs);

  return report;
}

function pad(s: string, w: number): string {
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}

export function formatDoctorReport(r: DoctorReport): string {
  const lines: string[] = [];
  lines.push('# node');
  lines.push(`  version: ${r.nodeVersion}`);
  lines.push(`  bin:     ${r.nodeBin}`);
  lines.push('');
  lines.push('# healthz');
  for (const h of r.healthz) {
    const status = h.ok ? 'OK' : 'FAIL';
    const detail = h.ok
      ? `http=${h.status} elapsed_ms=${h.elapsedMs}`
      : `error=${h.error ?? 'unknown'}`;
    lines.push(`  ${pad(h.name, 8)} ${pad(status, 4)} ${pad(h.url, 38)} ${detail}`);
  }
  lines.push('');
  lines.push('# launchd plists');
  lines.push(
    `  ${pad('label', 50)} ${pad('loaded', 8)} ${pad('state', 16)} ${pad('last_exit', 10)}`,
  );
  for (const p of r.plists) {
    lines.push(
      `  ${pad(p.label, 50)} ${pad(p.loaded ? 'yes' : 'no', 8)} ${pad(
        p.state ?? '-',
        16,
      )} ${pad(p.lastExitStatus === null ? '-' : String(p.lastExitStatus), 10)}`,
    );
  }
  lines.push('');
  lines.push('# chains');
  if (r.chains.length === 0) {
    lines.push('  (none)');
  } else {
    lines.push(
      `  ${pad('chain_id', 40)} ${pad('current_phase', 14)} ${pad('paused', 7)} ${pad('all_done', 9)} last_wake`,
    );
    for (const c of r.chains) {
      lines.push(
        `  ${pad(c.chainId, 40)} ${pad(
          c.currentPhase === null ? '-' : String(c.currentPhase),
          14,
        )} ${pad(c.paused === null ? '-' : String(c.paused), 7)} ${pad(
          c.allDone === null ? '-' : String(c.allDone),
          9,
        )} ${c.lastWake ?? 'never'}`,
      );
    }
  }
  // V2 sections — only emit when present so legacy callers see the original
  // four-section output verbatim.
  if (r.chainHealth) {
    lines.push('');
    lines.push('# chain health');
    if (r.chainHealth.length === 0) {
      lines.push('  (none)');
    } else {
      lines.push(
        `  ${pad('chain_id', 36)} ${pad('counts', 38)} ${pad('lock_age_sec', 12)} ${pad('streak', 6)} ${pad('stalled', 7)} last_phase_done`,
      );
      for (const c of r.chainHealth) {
        const countStr = Object.entries(c.counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(',');
        lines.push(
          `  ${pad(c.chainId, 36)} ${pad(countStr || '-', 38)} ${pad(
            c.lockAgeSec === null ? '-' : String(c.lockAgeSec),
            12,
          )} ${pad(String(c.noneEligibleStreak), 6)} ${pad(
            c.stalled ? 'yes' : 'no',
            7,
          )} ${c.lastPhaseDone ?? '-'}`,
        );
      }
    }
  }
  if (r.orphans) {
    lines.push('');
    lines.push('# orphans (dry-run)');
    const orphanCount = r.orphans.orphans.filter((o) => o.isOrphan).length;
    lines.push(
      `  candidates=${r.orphans.candidates} suspects=${r.orphans.suspects} orphans=${orphanCount}`,
    );
    for (const o of r.orphans.orphans.filter((o) => o.isOrphan)) {
      lines.push(
        `  pid=${o.pid} chain=${o.chainId} phase=${o.phaseId} status=${o.phaseStatus} age_sec=${o.ageSec}`,
      );
    }
  }
  if (r.disk) {
    lines.push('');
    lines.push('# disk');
    lines.push(`  ${pad('mount', 28)} ${pad('avail_kb', 14)} ${pad('total_kb', 14)} ok`);
    for (const d of r.disk) {
      lines.push(
        `  ${pad(d.mount, 28)} ${pad(String(d.availKb), 14)} ${pad(String(d.total), 14)} ${d.ok ? 'yes' : 'no'}`,
      );
    }
  }
  if (r.auth) {
    lines.push('');
    lines.push('# auth');
    if ('exit_code' in r.auth) {
      lines.push(
        `  status=${r.auth.status} exit=${r.auth.exit_code} elapsed_ms=${r.auth.elapsed_ms} message="${r.auth.message.slice(0, 200)}"`,
      );
    } else {
      lines.push(`  status=${r.auth.status} message="${r.auth.message.slice(0, 200)}"`);
    }
  }
  if (r.quota) {
    lines.push('');
    lines.push('# quota');
    if (r.quota.length === 0) {
      lines.push('  (no rate-limit banners in recent dispatch logs)');
    } else {
      for (const q of r.quota) {
        lines.push(
          `  chain=${q.chainId} reset_iso=${q.resetIso ?? '-'} banner="${q.banner}" log=${q.logPath}`,
        );
      }
    }
  }
  return lines.join('\n');
}

/**
 * Exit-code policy:
 *   0 healthy: every section ok
 *   1 degraded: healthz, disk, auth, or orphan scan reported a problem
 *   2 stalled-chain: any chain has stalled=true in chainHealth
 */
export function doctorExitCode(r: DoctorReport): number {
  if (r.chainHealth && r.chainHealth.some((c) => c.stalled)) return 2;
  if (r.healthz.some((h) => !h.ok)) return 1;
  if (r.disk && r.disk.some((d) => !d.ok)) return 1;
  if (r.auth && 'exit_code' in r.auth && r.auth.exit_code !== 0) return 1;
  return 0;
}
