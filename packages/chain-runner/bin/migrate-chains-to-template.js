#!/usr/bin/env node
// B3 (2026-05-15). One-shot migration: discover every chain that points at
// a standard 66-line bootstrap-generated dispatcher and convert it to the
// new canonical layout:
//   ~/.caia/dispatchers/<chain-id>.sh        (real dispatcher, fingerprint-stamped)
//   <existing agent-memory path>             (legacy 3-line wrapper)
//
// Skips chains whose dispatcher does not look template-rendered (cross-host
// shims to stolution's claude-spawner-agent, bespoke scripts that pre-date
// bootstrap-chain.ts, etc.). These get a "skipped, reason=..." line; they
// continue to work because the fingerprint guardrail lets unmarked scripts
// pass through.
//
// Usage:
//   node migrate-chains-to-template.js [--dry-run] [--force]
//
// --dry-run prints what would happen without writing.
// --force overwrites existing canonical paths (the agent-memory legacy
// path is always overwritten — that's the point of the migration).

import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateDispatcher } from '../dist/dispatcher-generator.js';

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const FORCE = ARGS.has('--force');

const HOME = homedir();
const WATCHDOG_DIR = join(HOME, '.caia', 'chain-watchdog');

function chainsFromPointers() {
  if (!existsSync(WATCHDOG_DIR)) return [];
  const out = [];
  for (const f of readdirSync(WATCHDOG_DIR)) {
    if (!f.endsWith('.runner')) continue;
    const chainId = f.slice(0, -'.runner'.length);
    const runnerPath = readFileSync(join(WATCHDOG_DIR, f), 'utf8').trim();
    const phasesFile = join(WATCHDOG_DIR, `${chainId}.phases`);
    const phasesPath = existsSync(phasesFile)
      ? readFileSync(phasesFile, 'utf8').trim()
      : null;
    out.push({ chainId, runnerPath, phasesPath });
  }
  return out;
}

/**
 * Heuristic: a script is a "standard" template-rendered dispatcher iff:
 *   - it contains the literal H-12 heartbeat comment, AND
 *   - it contains the literal _dispatcher_helpers.sh source, AND
 *   - it does NOT contain spawner_dispatch.sh (cross-host shim marker).
 *
 * These are reliable because both phrases come from the canonical template
 * and would diverge in any meaningfully different dispatcher.
 */
function isStandardTemplateDispatcher(scriptPath) {
  if (!existsSync(scriptPath)) return { ok: false, reason: 'missing' };
  if (!statSync(scriptPath).isFile()) return { ok: false, reason: 'not_a_file' };
  const body = readFileSync(scriptPath, 'utf8');
  if (body.includes('spawner_dispatch.sh')) {
    return { ok: false, reason: 'cross_host_shim' };
  }
  if (body.includes('# CAIA_DISPATCHER_FINGERPRINT:')) {
    return { ok: false, reason: 'already_migrated' };
  }
  if (body.includes('# CAIA_DISPATCHER_WRAPPER target=')) {
    return { ok: false, reason: 'already_a_wrapper' };
  }
  if (!body.includes('H-12: worker-level heartbeat')) {
    return { ok: false, reason: 'not_template_rendered' };
  }
  if (!body.includes('_dispatcher_helpers.sh')) {
    return { ok: false, reason: 'no_dispatcher_helpers_source' };
  }
  return { ok: true };
}

function logLine(parts) {
  process.stdout.write(parts.join(' ') + '\n');
}

function migrate(chain) {
  const verdict = isStandardTemplateDispatcher(chain.runnerPath);
  if (!verdict.ok) {
    logLine(['SKIP', chain.chainId, `reason=${verdict.reason}`, `path=${chain.runnerPath}`]);
    return { skipped: true, reason: verdict.reason };
  }
  if (!chain.phasesPath) {
    logLine(['SKIP', chain.chainId, 'reason=no_phases_pointer']);
    return { skipped: true, reason: 'no_phases_pointer' };
  }
  if (DRY_RUN) {
    logLine([
      'WOULD_MIGRATE',
      chain.chainId,
      `canonical=${join(HOME, '.caia', 'dispatchers', `${chain.chainId}.sh`)}`,
      `wrapper=${chain.runnerPath}`,
    ]);
    return { dry: true };
  }
  // Move the existing dispatcher aside so we can write the wrapper in its
  // place. If the migration aborts mid-way the original is recoverable.
  const backupPath = `${chain.runnerPath}.pre-b3-backup`;
  if (!existsSync(backupPath) || FORCE) {
    try {
      renameSync(chain.runnerPath, backupPath);
    } catch (err) {
      logLine(['FAIL', chain.chainId, `backup_rename_failed: ${err.message}`]);
      return { failed: true, reason: err.message };
    }
  }
  try {
    const r = generateDispatcher({
      chainId: chain.chainId,
      phasesYaml: chain.phasesPath,
      writeLegacyWrapper: true,
      legacyWrapperPath: chain.runnerPath,
      force: true, // The migration always overwrites — backups taken above.
    });
    logLine([
      'MIGRATED',
      chain.chainId,
      `canonical=${r.dispatcherPath}`,
      `wrapper=${r.legacyWrapperPath}`,
      `fingerprint=${r.fingerprint}`,
      `backup=${backupPath}`,
    ]);
    return { migrated: true, ...r };
  } catch (err) {
    // Roll back the rename so the chain keeps working.
    try {
      renameSync(backupPath, chain.runnerPath);
    } catch {
      // best effort
    }
    logLine(['FAIL', chain.chainId, `generate_failed: ${err.message}`]);
    return { failed: true, reason: err.message };
  }
}

const chains = chainsFromPointers();
logLine([`# discovered ${chains.length} chains from ${WATCHDOG_DIR}/*.runner`]);
const summary = { migrated: 0, skipped: 0, failed: 0 };
for (const c of chains) {
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
