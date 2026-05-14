// `caia-chain doctor` — operator-friendly health snapshot.
//
// Prints, in order:
//   1. node version (which interpreter caia-chain itself is running under)
//   2. healthz of mentor (5180) + local-llm-router (7411)
//   3. launchctl print state of each known plist (label + state + last_exit_status)
//   4. last_wake of each chain under ~/.caia/chain/*/state.json
//
// Designed for autonomous chains and human operators alike. Output is
// plain text on stdout with one table per section. Doctor exits 0 if
// every check passes, 1 if any check is degraded.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_HEALTHZ_ENDPOINTS,
  checkHealthzAll,
  type HealthzCheckResult,
} from './bootstrap.js';

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

export interface DoctorReport {
  nodeVersion: string;
  nodeBin: string;
  healthz: HealthzCheckResult[];
  plists: PlistState[];
  chains: ChainWakeState[];
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
  // launchctl print emits lines like `state = waiting` and
  // `last exit code = 0` (or `last exit status = -1`).
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

export async function runDoctor(opts: {
  uid?: number;
  chainRoot?: string;
  healthzTimeoutMs?: number;
  plistLabels?: readonly string[];
} = {}): Promise<DoctorReport> {
  const uid = opts.uid ?? process.getuid?.() ?? 501;
  const labels = opts.plistLabels ?? KNOWN_PLIST_LABELS;
  const healthz = await checkHealthzAll(DEFAULT_HEALTHZ_ENDPOINTS, {
    timeoutMs: opts.healthzTimeoutMs ?? 2_000,
  });
  const plists = labels.map((l) => inspectPlist(l, uid));
  const chains = readChainWakes(opts.chainRoot);
  return {
    nodeVersion: process.version,
    nodeBin: process.execPath,
    healthz,
    plists,
    chains,
  };
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
  return lines.join('\n');
}

export function doctorExitCode(r: DoctorReport): number {
  if (r.healthz.some((h) => !h.ok)) return 1;
  return 0;
}
