// H-47 (chain-runner-battle-harden phase 12, 2026-05-14). Bootstrap a brand-
// new chain from a single CLI call: render the wake script, runner shell,
// launchd plist, and state.json scaffold from templates. Eliminates the
// hand-copied wake-script trios that drifted in incompatible ways across
// the existing chains (apprentice / redflag / harden).
//
// Pure file-system + child_process; no external deps. Caller-provided
// io overrides keep the unit tests deterministic.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isoNow } from './time.js';
import { ensureChainDir } from './paths.js';
import { initState } from './state.js';
import { loadChainSpec } from './spec.js';
import { pause } from './state.js';
import type { StateContext } from './state.js';
import { appendAudit } from './audit.js';

/**
 * Inputs to `bootstrap-new-chain`. Every path / label is required so the
 * generated artifacts are deterministic and reproducible.
 */
export interface BootstrapNewChainOptions {
  /** Launchd label, e.g. com.caia.chain-runner.my-chain. */
  label: string;
  /** Chain id; matches the directory under ~/.caia/chain/. */
  chainId: string;
  /** Absolute path to the phases YAML. */
  phasesYaml: string;
  /** Cron schedule (5 fields), e.g. '*\/15 * * * *'. */
  schedule: string;
  /** Skip `launchctl bootstrap` even when we would otherwise run it. */
  noBootstrap?: boolean;
  /** Overwrite existing artifacts (wake script / runner / plist). */
  force?: boolean;
  /** Override paths for tests. */
  paths?: Partial<BootstrapPaths>;
  /**
   * When provided, scaffold state.json + ensure chain dir but do not call
   * `pause`. Default: chain is paused on bootstrap to require an explicit
   * operator `resume`.
   */
  startUnpaused?: boolean;
  /**
   * Override the slug used to derive log filenames + the phase-log dir.
   * Defaults to `deriveLogSlug(chainId)`. Used by the existing-chain
   * migration to preserve legacy short slugs (e.g. `chain_harden` for
   * `chain-runner-battle-harden`).
   */
  logSlug?: string;
  /**
   * Override the wake-script absolute path. Defaults to
   * `<watchdogDir>/<chainId>_wake.sh`. Migration uses this to preserve
   * legacy filenames like `chain_harden_wake.sh`.
   */
  wakeScriptOut?: string;
  /** Override the runner-script absolute path. */
  runnerScriptOut?: string;
  /** Override the plist absolute path. */
  plistOut?: string;
  /** Override the phase-log directory written into the runner. */
  phaseLogDirOut?: string;
}

export interface BootstrapPaths {
  home: string;
  /** Absolute path to bin/caia-chain.js. */
  caiaChainBin: string;
  /** Where wake scripts live. */
  watchdogDir: string;
  /** Where runner shells + phase logs live. */
  runnerDir: string;
  /** Where the launchd plist is installed. */
  launchAgentsDir: string;
  /** Where this package's bin/templates/ lives. */
  templatesDir: string;
}

export interface BootstrapResult {
  wakeScript: string;
  runnerScript: string;
  plist: string;
  stateFile: string;
  phasesPointerFile: string;
  runnerPointerFile: string;
  bootstrapped: boolean;
}

/** Default file-system layout for the running operator's machine. */
export function defaultBootstrapPaths(): BootstrapPaths {
  const here = dirname(fileURLToPath(import.meta.url));
  // Compiled `dist/` lives one level below the package root. Templates live
  // in `bin/templates/` at the package root either way.
  const pkgRoot = pathResolve(here, '..');
  const templatesFromDist = pathResolve(pkgRoot, 'bin', 'templates');
  const templatesFromSrc = pathResolve(dirname(pkgRoot), 'bin', 'templates');
  const templatesDir = existsSync(templatesFromDist)
    ? templatesFromDist
    : templatesFromSrc;
  const home = homedir();
  return {
    home,
    caiaChainBin: join(
      home,
      'Documents/projects/caia/packages/chain-runner/bin/caia-chain.js',
    ),
    watchdogDir: join(home, '.caia/chain-watchdog'),
    runnerDir: join(home, 'Documents/projects/agent-memory'),
    launchAgentsDir: join(home, 'Library/LaunchAgents'),
    templatesDir,
  };
}

// Plist generation -----------------------------------------------------------

const CRON_FIELDS: ReadonlyArray<keyof CronTuple> = [
  'Minute',
  'Hour',
  'Day',
  'Month',
  'Weekday',
];

interface CronTuple {
  Minute?: number[];
  Hour?: number[];
  Day?: number[];
  Month?: number[];
  Weekday?: number[];
}

/**
 * Parse a 5-field cron string into a CronTuple. Supports `*`, single ints,
 * comma-separated lists, and `*\/n` step expressions. Returns one entry per
 * concrete time the cron would fire in a 60-min minute-wheel window, so
 * `*\/15 * * * *` becomes `Minute: [0, 15, 30, 45]`. The plist emits one
 * `StartCalendarInterval` dict per entry.
 */
export function parseCron(cron: string): CronTuple {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `invalid cron ${JSON.stringify(cron)}: expected 5 fields, got ${parts.length}`,
    );
  }
  const out: CronTuple = {};
  CRON_FIELDS.forEach((field, i) => {
    const range = cronRanges[field];
    const tok = parts[i] as string;
    const vals = expandField(tok, range);
    if (vals !== null) out[field] = vals;
  });
  return out;
}

const cronRanges: Record<keyof CronTuple, [number, number]> = {
  Minute: [0, 59],
  Hour: [0, 23],
  Day: [1, 31],
  Month: [1, 12],
  Weekday: [0, 6],
};

function expandField(tok: string, [min, max]: [number, number]): number[] | null {
  if (tok === '*') return null;
  if (tok.startsWith('*/')) {
    const step = Number(tok.slice(2));
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`invalid cron step ${JSON.stringify(tok)}`);
    }
    const out: number[] = [];
    for (let v = min; v <= max; v += step) out.push(v);
    return out;
  }
  if (tok.includes(',')) {
    return tok.split(',').map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n < min || n > max) {
        throw new Error(`invalid cron value ${JSON.stringify(s)} in ${JSON.stringify(tok)}`);
      }
      return n;
    });
  }
  const n = Number(tok);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`invalid cron value ${JSON.stringify(tok)}`);
  }
  return [n];
}

/**
 * Render the cron tuple into a `StartCalendarInterval` plist block. When no
 * fields are constrained (all wildcards) we emit a single empty dict, which
 * tells launchd "every minute".
 */
export function renderScheduleBlock(cron: CronTuple): string {
  const concrete = CRON_FIELDS.filter((f) => cron[f] !== undefined);
  if (concrete.length === 0) {
    return '\t<key>StartCalendarInterval</key>\n\t<dict></dict>';
  }
  // If only Minute is constrained, emit one dict per minute (the common case
  // for */15-style crons). Otherwise emit the cartesian product, capped at
  // 60 entries (the size of an hour); anything finer should be a different
  // scheduling mechanism.
  const tuples: Array<Partial<Record<keyof CronTuple, number>>> = [{}];
  for (const f of concrete) {
    const vs = cron[f] as number[];
    const next: typeof tuples = [];
    for (const t of tuples) {
      for (const v of vs) next.push({ ...t, [f]: v });
    }
    tuples.length = 0;
    tuples.push(...next);
    if (tuples.length > 60) {
      throw new Error(`cron expansion exceeded 60 entries (${tuples.length})`);
    }
  }
  const lines: string[] = ['\t<key>StartCalendarInterval</key>', '\t<array>'];
  for (const t of tuples) {
    lines.push('\t\t<dict>');
    for (const f of CRON_FIELDS) {
      const v = t[f];
      if (v === undefined) continue;
      lines.push(`\t\t\t<key>${f}</key>`);
      lines.push(`\t\t\t<integer>${v}</integer>`);
    }
    lines.push('\t\t</dict>');
  }
  lines.push('\t</array>');
  return lines.join('\n');
}

// Template rendering ---------------------------------------------------------

export interface TemplateContext {
  CHAIN_ID: string;
  PHASES_FILE: string;
  RUNNER_SCRIPT: string;
  CAIA_CHAIN_BIN: string;
  LOG_SLUG: string;
  PHASE_LOG_DIR: string;
  HOME: string;
  LABEL: string;
  WAKE_SCRIPT: string;
  SCHEDULE_BLOCK: string;
  GENERATED_AT: string;
}

export function renderTemplate(
  templateBody: string,
  ctx: TemplateContext,
): string {
  return templateBody.replace(/\{\{([A-Z_]+)\}\}/g, (_m, key: string) => {
    const v = (ctx as unknown as Record<string, string | undefined>)[key];
    if (v === undefined) {
      throw new Error(`template placeholder {{${key}}} has no binding`);
    }
    return v;
  });
}

// File slug helpers ----------------------------------------------------------

/**
 * Derive the "log slug" used for daily-rotated log files
 * (e.g. `chain-runner-battle-harden` → `chain_harden`). Replaces hyphens
 * with underscores and is a no-op when already underscored. Caller can
 * override via the optional `logSlug` field if they want backwards-compat
 * with an existing log layout.
 */
export function deriveLogSlug(chainId: string): string {
  return chainId.replace(/-/g, '_');
}

export function deriveRunnerName(chainId: string): string {
  return `_${deriveLogSlug(chainId)}_run_phase.sh`;
}

export function deriveWakeName(chainId: string): string {
  return `${chainId}_wake.sh`;
}

export function derivePhaseLogDir(home: string, chainId: string): string {
  return join(home, 'Documents/projects/agent-memory', `_${deriveLogSlug(chainId)}_phase_logs`);
}

// Main entry point -----------------------------------------------------------

/**
 * Scaffold the wake script, runner shell, plist, and state.json for a new
 * chain. Returns the absolute paths of every file touched.
 *
 * Idempotency: if `force` is true, existing files are overwritten; otherwise
 * an existing file at any of the four destinations is an error. The
 * state.json scaffold is gated separately — if it already exists, we skip
 * the `initState` call (so re-bootstrapping a paused chain does not wipe
 * its state).
 */
export function bootstrapNewChain(
  opts: BootstrapNewChainOptions,
): BootstrapResult {
  const paths = { ...defaultBootstrapPaths(), ...(opts.paths ?? {}) };
  const cron = parseCron(opts.schedule);
  const scheduleBlock = renderScheduleBlock(cron);

  // Compute file destinations. Caller can override any path; defaults are
  // chain-id-derived (see derive* helpers).
  const logSlug = opts.logSlug ?? deriveLogSlug(opts.chainId);
  const wakeScript =
    opts.wakeScriptOut ?? join(paths.watchdogDir, deriveWakeName(opts.chainId));
  const runnerScript =
    opts.runnerScriptOut ?? join(paths.runnerDir, deriveRunnerName(opts.chainId));
  const phaseLogDir =
    opts.phaseLogDirOut ?? derivePhaseLogDir(paths.home, opts.chainId);
  const plist =
    opts.plistOut ?? join(paths.launchAgentsDir, `${opts.label}.plist`);
  const phasesPointerFile = join(paths.watchdogDir, `${opts.chainId}.phases`);
  const runnerPointerFile = join(paths.watchdogDir, `${opts.chainId}.runner`);

  if (!opts.force) {
    for (const p of [wakeScript, runnerScript, plist]) {
      if (existsSync(p)) {
        throw new Error(
          `${p} already exists — pass --force to overwrite, or move it aside first`,
        );
      }
    }
  }

  mkdirSync(paths.watchdogDir, { recursive: true });
  mkdirSync(paths.runnerDir, { recursive: true });
  mkdirSync(paths.launchAgentsDir, { recursive: true });

  // Read templates.
  const wakeTpl = readFileSync(join(paths.templatesDir, 'wake.sh.template'), 'utf8');
  const runnerTpl = readFileSync(join(paths.templatesDir, 'run-phase.sh.template'), 'utf8');
  const plistTpl = readFileSync(join(paths.templatesDir, 'plist.template'), 'utf8');

  const ctx: TemplateContext = {
    CHAIN_ID: opts.chainId,
    PHASES_FILE: opts.phasesYaml,
    RUNNER_SCRIPT: runnerScript,
    CAIA_CHAIN_BIN: paths.caiaChainBin,
    LOG_SLUG: logSlug,
    PHASE_LOG_DIR: phaseLogDir,
    HOME: paths.home,
    LABEL: opts.label,
    WAKE_SCRIPT: wakeScript,
    SCHEDULE_BLOCK: scheduleBlock,
    GENERATED_AT: isoNow(),
  };

  writeFileSync(wakeScript, renderTemplate(wakeTpl, ctx), 'utf8');
  chmodSync(wakeScript, 0o755);
  writeFileSync(runnerScript, renderTemplate(runnerTpl, ctx), 'utf8');
  chmodSync(runnerScript, 0o755);
  writeFileSync(plist, renderTemplate(plistTpl, ctx), 'utf8');

  // Pointer files used by the H-39 watchdog shim to discover per-chain runners.
  writeFileSync(phasesPointerFile, `${opts.phasesYaml}\n`, 'utf8');
  writeFileSync(runnerPointerFile, `${runnerScript}\n`, 'utf8');

  // State scaffold — paused by default so the first wake doesn't dispatch.
  const stateCtx: StateContext = {
    paths: ensureChainDir(opts.chainId),
    spec: loadChainSpec(opts.phasesYaml),
  };
  if (!existsSync(stateCtx.paths.stateFile)) {
    initState(stateCtx);
    if (!opts.startUnpaused) {
      pause(stateCtx, {
        reason: `bootstrapped by caia-chain bootstrap-new-chain at ${ctx.GENERATED_AT} — resume when ready`,
      });
    }
  }

  appendAudit(stateCtx.paths.auditFile, 'chain_bootstrapped', {
    label: opts.label,
    schedule: opts.schedule,
    wake_script: wakeScript,
    runner_script: runnerScript,
    plist,
    paused: !opts.startUnpaused,
  });

  let bootstrapped = false;
  if (!opts.noBootstrap) {
    bootstrapped = bootstrapLaunchd(plist);
  }

  return {
    wakeScript,
    runnerScript,
    plist,
    stateFile: stateCtx.paths.stateFile,
    phasesPointerFile,
    runnerPointerFile,
    bootstrapped,
  };
}

/**
 * `launchctl bootstrap gui/$(id -u) <plist>`. Returns true on exit 0,
 * false on any failure. Caller logs the outcome; we do not throw because
 * a pre-existing plist label simply needs `launchctl bootout` first.
 */
export function bootstrapLaunchd(plist: string): boolean {
  try {
    const uid = process.getuid?.() ?? 0;
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plist], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}
