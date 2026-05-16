#!/usr/bin/env node
// B4 (2026-05-15). One-shot migration: discover every chain that points at
// a standard bootstrap-generated wake script and convert it to the new
// canonical layout:
//   ~/.caia/wake-scripts/<chain-id>.sh                 (real wake, fingerprint-stamped)
//   ~/.caia/chain-watchdog/<slug>_wake.sh              (legacy 3-line wrapper)
//
// Skips chains whose wake script does not look template-rendered (bespoke
// scripts that pre-date the template, hand-modified copies). These get a
// "skipped, reason=..." line.
//
// Usage:
//   node migrate-wakes-to-template.js [--dry-run] [--force]
//
// --dry-run prints what would happen without writing.
// --force overwrites existing canonical paths (the watchdog-dir legacy
// path is always overwritten — that's the point of the migration).

import { existsSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { generateWake } from '../dist/wake-generator.js';

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const FORCE = ARGS.has('--force');

const HOME = homedir();
const WATCHDOG_DIR = join(HOME, '.caia', 'chain-watchdog');

function chainsFromWatchdogDir() {
  if (!existsSync(WATCHDOG_DIR)) return [];
  // Prefer the `<chain-id>.phases` pointer (B3 layout) when present.
  const pointers = new Map();
  for (const f of readdirSync(WATCHDOG_DIR)) {
    if (!f.endsWith('.phases')) continue;
    const chainId = f.slice(0, -'.phases'.length);
    const phasesPath = readFileSync(join(WATCHDOG_DIR, f), 'utf8').trim();
    pointers.set(chainId, phasesPath);
  }

  // Discover wake scripts. Two naming conventions exist:
  //   <chain-id>_wake.sh        (e.g. redflag-remediation_wake.sh — newest)
  //   <slug>_wake.sh            (e.g. chain_harden_wake.sh — legacy)
  const out = [];
  for (const f of readdirSync(WATCHDOG_DIR)) {
    if (!f.endsWith('_wake.sh')) continue;
    const wakePath = join(WATCHDOG_DIR, f);
    const base = f.slice(0, -'_wake.sh'.length);
    // Try base verbatim first (matches `<chain-id>_wake.sh`).
    let chainId = base;
    let phasesPath = pointers.get(chainId);
    if (!phasesPath) {
      // Try replacing underscores back to hyphens (matches `<slug>_wake.sh`).
      const candidate = base.replace(/_/g, '-');
      if (pointers.has(candidate)) {
        chainId = candidate;
        phasesPath = pointers.get(candidate);
      }
    }
    out.push({ chainId, wakePath, phasesPath: phasesPath ?? null });
  }
  return out;
}

/**
 * Heuristic: a wake script is "standard" iff:
 *   - it contains the literal "watchdog wake start" log line, AND
 *   - it contains the `_wake_helpers.sh` source line, AND
 *   - it does NOT carry the fingerprint stamp or wrapper marker already.
 */
function isStandardTemplateWake(scriptPath) {
  if (!existsSync(scriptPath)) return { ok: false, reason: 'missing' };
  if (!statSync(scriptPath).isFile()) return { ok: false, reason: 'not_a_file' };
  const body = readFileSync(scriptPath, 'utf8');
  if (body.includes('# CAIA_WAKE_FINGERPRINT:')) {
    return { ok: false, reason: 'already_migrated' };
  }
  if (body.includes('# CAIA_WAKE_WRAPPER target=')) {
    return { ok: false, reason: 'already_a_wrapper' };
  }
  if (!body.includes('watchdog wake start')) {
    return { ok: false, reason: 'no_watchdog_wake_start_marker' };
  }
  if (!body.includes('_wake_helpers.sh')) {
    return { ok: false, reason: 'no_wake_helpers_source' };
  }
  return { ok: true };
}

function deriveRunnerScript(scriptBody) {
  // Try to extract the RUNNER_SCRIPT="..." line so the wrapper preserves
  // the per-chain runner pointer when the existing wake.sh bakes one in.
  const m = scriptBody.match(/^RUNNER_SCRIPT="([^"]+)"/m);
  return m ? m[1] : null;
}

function deriveLogSlugFromScript(scriptBody) {
  // Extract LOG_SLUG embedded in the WATCHDOG_LOG path so we preserve
  // legacy slugs (e.g. `chain_harden` for `chain-runner-battle-harden`).
  const m = scriptBody.match(/WATCHDOG_LOG="\$WATCHDOG_LOG_DIR\/([^_]+(?:_[^_]+)*?)_\$\(date/);
  return m ? m[1] : null;
}

function logLine(parts) {
  process.stdout.write(parts.join(' ') + '\n');
}

function migrate(chain) {
  const verdict = isStandardTemplateWake(chain.wakePath);
  if (!verdict.ok) {
    logLine(['SKIP', chain.chainId, `reason=${verdict.reason}`, `path=${chain.wakePath}`]);
    return { skipped: true, reason: verdict.reason };
  }
  if (!chain.phasesPath) {
    logLine(['SKIP', chain.chainId, 'reason=no_phases_pointer']);
    return { skipped: true, reason: 'no_phases_pointer' };
  }
  const body = readFileSync(chain.wakePath, 'utf8');
  const runnerScript = deriveRunnerScript(body);
  const logSlug = deriveLogSlugFromScript(body);
  if (!runnerScript) {
    logLine(['SKIP', chain.chainId, 'reason=no_runner_script_assignment']);
    return { skipped: true, reason: 'no_runner_script_assignment' };
  }

  const canonicalOut = join(HOME, '.caia', 'wake-scripts', `${chain.chainId}.sh`);
  if (DRY_RUN) {
    logLine([
      'WOULD_MIGRATE',
      chain.chainId,
      `canonical=${canonicalOut}`,
      `wrapper=${chain.wakePath}`,
      `runner=${runnerScript}`,
      ...(logSlug ? [`log_slug=${logSlug}`] : []),
    ]);
    return { dry: true };
  }

  const backupPath = `${chain.wakePath}.pre-b4-backup`;
  if (!existsSync(backupPath) || FORCE) {
    try {
      renameSync(chain.wakePath, backupPath);
    } catch (err) {
      logLine(['FAIL', chain.chainId, `backup_rename_failed: ${err.message}`]);
      return { failed: true, reason: err.message };
    }
  }
  try {
    const r = generateWake({
      chainId: chain.chainId,
      phasesYaml: chain.phasesPath,
      runnerScript,
      logSlug: logSlug ?? undefined,
      writeLegacyWrapper: true,
      legacyWrapperPath: chain.wakePath,
      force: true,
    });
    logLine([
      'MIGRATED',
      chain.chainId,
      `canonical=${r.wakeScriptPath}`,
      `wrapper=${r.legacyWrapperPath}`,
      `fingerprint=${r.fingerprint}`,
      `backup=${backupPath}`,
    ]);
    return { migrated: true, ...r };
  } catch (err) {
    try {
      renameSync(backupPath, chain.wakePath);
    } catch {
      // best effort rollback
    }
    logLine(['FAIL', chain.chainId, `generate_failed: ${err.message}`]);
    return { failed: true, reason: err.message };
  }
}

const chains = chainsFromWatchdogDir();
logLine([`# discovered ${chains.length} wake scripts in ${WATCHDOG_DIR}`]);
const summary = { migrated: 0, skipped: 0, failed: 0 };
const seen = new Set();
for (const c of chains) {
  // Deduplicate when both `<chain-id>_wake.sh` and `<slug>_wake.sh` exist.
  const key = `${c.chainId}::${basename(c.wakePath)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const r = migrate(c);
  if (r.migrated) summary.migrated++;
  else if (r.failed) summary.failed++;
  else summary.skipped++;
}
logLine([
  `# done: migrated=${summary.migrated} skipped=${summary.skipped} failed=${summary.failed}` +
    (DRY_RUN ? ' (dry-run)' : ''),
]);
process.exit(summary.failed > 0 ? 1 : 0);
