#!/usr/bin/env node
// Belt-and-suspenders watchdog for the chain-runner.
//
// H-38 (chain-runner-battle-harden phase 11, 2026-05-14). Pre-H-38 this
// file owned a duplicate of the stall-detection / alert-emit logic that
// also lived in src/watchdog.ts and src/alerting.ts (the TS check-stall +
// emit-alert verbs). Two writers, one signal — drift across them was the
// source of two confusing past incidents. Post-H-38 this file is a thin
// shim: it iterates ~/.caia/chain/* directories, looks each chain up in
// the per-chain registry (~/.caia/chain-watchdog/<chain-id>.phases for the
// YAML and <chain-id>.runner for the optional poke command), and forks
// `caia-chain check-stall` per chain. The TS owns alert dedupe, channel
// fan-out, and audit recording.
//
// H-39 (phase 11, 2026-05-14). pokeChain semantics preserved. Wake scripts
// live as <chain-id>.runner files in this directory; their contents is a
// single shell command run on stall (typically the per-chain wake script).
//
// H-40 (phase 11, 2026-05-14). Once per UTC day the shim also runs
// `caia-chain prune-inbox --inbox INBOX.md --days 7` so the live INBOX
// stays small. The state cookie .last_prune.json records when it last ran
// to avoid re-pruning on every wake.
//
// Logs land in ~/.caia/chain-watchdog/watchdog.scan.log (script-internal,
// verbose) and ~/.caia/chain-watchdog/watchdog.out.log (launchd stdout —
// one summary line per scan). H-41 (cluster B of phase 11).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const CHAIN_ROOT = process.env.CAIA_CHAIN_HOME || path.join(os.homedir(), '.caia', 'chain');
// H-38: WATCHDOG_HOME also honors an env override so the tests + sandbox
// setups can point the shim at a tmpdir without having to spoof HOME.
const WATCHDOG_HOME =
  process.env.CAIA_WATCHDOG_HOME || path.join(os.homedir(), '.caia', 'chain-watchdog');
const INBOX_PATH = path.join(WATCHDOG_HOME, 'INBOX.md');
const LOG_PATH = path.join(WATCHDOG_HOME, 'watchdog.scan.log');
const PRUNE_COOKIE = path.join(WATCHDOG_HOME, '.last_prune.json');
const STALL_THRESHOLD_SEC = Number(process.env.CAIA_WATCHDOG_THRESHOLD_SEC || 3600);
const RETENTION_DAYS = Number(process.env.CAIA_WATCHDOG_INBOX_DAYS || 7);
const CAIA_CHAIN_BIN =
  process.env.CAIA_CHAIN_BIN ||
  path.join(
    os.homedir(),
    'Documents',
    'projects',
    'caia',
    'packages',
    'chain-runner',
    'bin',
    'caia-chain.js',
  );
const NODE_BIN = process.env.NODE_BIN || process.execPath;

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  try {
    fs.mkdirSync(WATCHDOG_HOME, { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
}

function emitStdoutSummary(parts) {
  process.stdout.write(`[${new Date().toISOString()}] ${parts.join(' ')}\n`);
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// H-38: per-chain registry lookup. Returns the path to the phases YAML for
// `chainId` if a `<chain-id>.phases` file exists in WATCHDOG_HOME and points
// to a readable file. Otherwise returns null and the chain is skipped.
function findPhasesYaml(chainId) {
  const reg = path.join(WATCHDOG_HOME, `${chainId}.phases`);
  if (!fs.existsSync(reg)) return null;
  let p;
  try {
    p = fs.readFileSync(reg, 'utf8').trim();
  } catch (err) {
    log('phases_registry_read_failed', chainId, err.message);
    return null;
  }
  if (!p) return null;
  // Expand ~ if present.
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  if (!fs.existsSync(p)) {
    log('phases_yaml_missing', chainId, p);
    return null;
  }
  return p;
}

// H-39: optional re-register/poke command. Same convention as pre-H-38 — the
// chain id maps to a single shell command line in <chain-id>.runner. Forwarded
// to `caia-chain check-stall --reregister-cmd` so the TS owns the actual exec.
function findRunnerCmd(chainId) {
  const reg = path.join(WATCHDOG_HOME, `${chainId}.runner`);
  if (!fs.existsSync(reg)) return null;
  try {
    const txt = fs.readFileSync(reg, 'utf8').trim();
    return txt || null;
  } catch {
    return null;
  }
}

// H-38: invoke `caia-chain check-stall`. The TS owns:
//   - the actual stall threshold computation
//   - audit-event emission (cron_stall_detected via emit-alert)
//   - INBOX append + handoff JSONL append + osascript notification
//   - 6h fingerprint dedupe across all those channels
function runCheckStall(chainId, phasesPath, runnerCmd) {
  if (!fs.existsSync(CAIA_CHAIN_BIN)) {
    log('check_stall_skipped_no_bin', chainId, CAIA_CHAIN_BIN);
    return { ran: false, reason: 'no_bin' };
  }
  const args = [
    CAIA_CHAIN_BIN,
    'check-stall',
    '--chain-id', chainId,
    '--phases', phasesPath,
    '--wake-interval-sec', '900',
    '--multiplier', String(Math.ceil(STALL_THRESHOLD_SEC / 900)),
    '--inbox', INBOX_PATH,
    '--alert-on-streak', '2',
  ];
  if (runnerCmd) {
    args.push('--reregister-cmd', runnerCmd);
  }
  try {
    const out = cp.spawnSync(NODE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    const stdoutStr = (out.stdout || '').toString('utf8').trim();
    const stderrStr = (out.stderr || '').toString('utf8').trim();
    log('check_stall', chainId, 'exit=', out.status, 'out=', stdoutStr);
    if (stderrStr) log('check_stall_stderr', chainId, stderrStr);
    return { ran: true, exit: out.status, out: stdoutStr };
  } catch (err) {
    log('check_stall_failed', chainId, err.message);
    return { ran: false, reason: err.message };
  }
}

// H-40: daily INBOX prune. Reads .last_prune.json; if today's UTC date is
// past the cookie, runs `caia-chain prune-inbox` and refreshes the cookie.
function maybePruneInbox() {
  if (!fs.existsSync(CAIA_CHAIN_BIN)) return { ran: false, reason: 'no_bin' };
  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const cookie = readJsonSafe(PRUNE_COOKIE);
  if (cookie && cookie.last_run === todayKey) {
    return { ran: false, reason: 'already_today' };
  }
  if (!fs.existsSync(INBOX_PATH)) {
    // Mark cookie anyway so we don't re-check on every wake.
    try {
      fs.writeFileSync(PRUNE_COOKIE, JSON.stringify({ last_run: todayKey }));
    } catch {}
    return { ran: false, reason: 'no_inbox' };
  }
  const args = [
    CAIA_CHAIN_BIN,
    'prune-inbox',
    '--inbox', INBOX_PATH,
    '--days', String(RETENTION_DAYS),
  ];
  try {
    const out = cp.spawnSync(NODE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    const stdoutStr = (out.stdout || '').toString('utf8').trim();
    log('prune_inbox', 'exit=', out.status, 'out=', stdoutStr);
    try {
      fs.writeFileSync(PRUNE_COOKIE, JSON.stringify({ last_run: todayKey, summary: stdoutStr }));
    } catch {}
    return { ran: true, exit: out.status, out: stdoutStr };
  } catch (err) {
    log('prune_inbox_failed', err.message);
    return { ran: false, reason: err.message };
  }
}

function listChains() {
  if (!fs.existsSync(CHAIN_ROOT)) return [];
  return fs.readdirSync(CHAIN_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function scanAndDelegate() {
  const chains = listChains();
  let scanned = 0;
  let delegated = 0;
  let skipped = 0;
  for (const chainId of chains) {
    const stateFile = path.join(CHAIN_ROOT, chainId, 'state.json');
    if (!fs.existsSync(stateFile)) continue;
    scanned += 1;
    const state = readJsonSafe(stateFile);
    if (!state) {
      log('unparseable_state', chainId);
      continue;
    }
    if (state.all_done) continue;
    if (state.paused) continue;
    const phasesPath = findPhasesYaml(chainId);
    if (!phasesPath) {
      log('skipping_no_phases_yaml', chainId);
      skipped += 1;
      continue;
    }
    const runnerCmd = findRunnerCmd(chainId);
    runCheckStall(chainId, phasesPath, runnerCmd);
    delegated += 1;
  }
  const pruneResult = maybePruneInbox();
  log('scan_complete', 'scanned=', scanned, 'delegated=', delegated, 'skipped=', skipped, 'prune_ran=', pruneResult.ran);
  emitStdoutSummary([
    `scan_complete scanned=${scanned} delegated=${delegated} skipped=${skipped} prune_ran=${pruneResult.ran}`,
  ]);
}

scanAndDelegate();
