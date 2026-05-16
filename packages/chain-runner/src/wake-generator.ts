// B4 (integration-remediation-b phase 4, 2026-05-15). Generate per-chain
// launchd wake scripts from the canonical template (`bin/templates/wake.sh.template`)
// and stamp the embedded fingerprint. Parallels dispatcher-generator.ts.
//
// CLI entry: bin/generate-wake.js → calls into generateWake().
//
// Output layout (canonical):
//   ~/.caia/wake-scripts/<chain-id>.sh         (the real wake script)
//   ~/.caia/chain-watchdog/<slug>_wake.sh      (3-line wrapper preserving plist contract)
//
// The wrapper preserves the existing plist invariant: every existing
// `com.caia.chain-runner.<chain>.plist` has the old `~/.caia/chain-watchdog/<slug>_wake.sh`
// path baked in. Repointing the plist requires `launchctl bootstrap` which
// is operator-side; the wrapper lets the plist keep working until the
// operator re-bootstraps.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isoNow } from './time.js';
import {
  fingerprintWakeTemplate,
  WAKE_FINGERPRINT_COMMENT_PREFIX,
  WAKE_WRAPPER_COMMENT_PREFIX,
} from './wake-fingerprint.js';
import {
  deriveLogSlug,
  deriveWakeName,
  renderTemplate,
  defaultBootstrapPaths,
} from './bootstrap-chain.js';
import type { TemplateContext } from './bootstrap-chain.js';

export interface GenerateWakeOptions {
  chainId: string;
  phasesYaml: string;
  /** The runner script the wake script will dispatch to. Defaults to the legacy agent-memory path. */
  runnerScript?: string;
  /** Override the output path. Defaults to ~/.caia/wake-scripts/<chain-id>.sh. */
  out?: string;
  /** Override the canonical template path. Defaults to bin/templates/wake.sh.template. */
  templatePath?: string;
  /** Override the caia-chain.js path. */
  caiaChainBin?: string;
  /** Override the log slug (rare; used by chain-runner-battle-harden which keeps a legacy slug). */
  logSlug?: string;
  /** When true, also write the legacy wrapper at ~/.caia/chain-watchdog/<slug>_wake.sh. */
  writeLegacyWrapper?: boolean;
  /** Override the legacy wrapper path. */
  legacyWrapperPath?: string;
  /** Allow overwriting an existing output file. */
  force?: boolean;
}

export interface GenerateWakeResult {
  wakeScriptPath: string;
  legacyWrapperPath: string | null;
  fingerprint: string;
}

function defaultWakeScriptsDir(): string {
  return join(homedir(), '.caia', 'wake-scripts');
}

function defaultTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = pathResolve(here, '..');
  const fromDist = pathResolve(pkgRoot, 'bin', 'templates', 'wake.sh.template');
  if (existsSync(fromDist)) return fromDist;
  return pathResolve(dirname(pkgRoot), 'bin', 'templates', 'wake.sh.template');
}

export function loadCanonicalWakeTemplate(templatePath?: string): {
  templateBody: string;
  templatePath: string;
} {
  const tp = templatePath ?? defaultTemplatePath();
  return { templateBody: readFileSync(tp, 'utf8'), templatePath: tp };
}

export function canonicalWakeTemplateFingerprint(templatePath?: string): string {
  return fingerprintWakeTemplate(loadCanonicalWakeTemplate(templatePath).templateBody);
}

/**
 * Render the wake template for `chainId`, prepend the fingerprint comment,
 * and write to disk. Returns the absolute path(s) written + the fingerprint
 * stamped.
 */
export function generateWake(opts: GenerateWakeOptions): GenerateWakeResult {
  const { templateBody, templatePath } = loadCanonicalWakeTemplate(opts.templatePath);
  const fingerprint = fingerprintWakeTemplate(templateBody);

  const home = homedir();
  const bp = defaultBootstrapPaths();
  const wakeScriptPath = opts.out ?? join(defaultWakeScriptsDir(), `${opts.chainId}.sh`);
  const caiaChainBin = opts.caiaChainBin ?? bp.caiaChainBin;
  const runnerScript =
    opts.runnerScript ?? join(bp.runnerDir, `_${deriveLogSlug(opts.chainId)}_run_phase.sh`);
  const logSlug = opts.logSlug ?? deriveLogSlug(opts.chainId);

  const ctx: TemplateContext = {
    CHAIN_ID: opts.chainId,
    PHASES_FILE: opts.phasesYaml,
    RUNNER_SCRIPT: runnerScript,
    CAIA_CHAIN_BIN: caiaChainBin,
    LOG_SLUG: logSlug,
    PHASE_LOG_DIR: '',
    HOME: home,
    LABEL: `com.caia.chain-runner.${opts.chainId}`,
    WAKE_SCRIPT: wakeScriptPath,
    SCHEDULE_BLOCK: '',
    GENERATED_AT: isoNow(),
  };

  const rendered = renderTemplate(templateBody, ctx);
  const stamped = stampWakeFingerprint(rendered, fingerprint, {
    chainId: opts.chainId,
    templatePath,
  });

  if (!opts.force && existsSync(wakeScriptPath)) {
    throw new Error(
      `${wakeScriptPath} already exists — pass --force to overwrite, or move it aside first`,
    );
  }
  mkdirSync(dirname(wakeScriptPath), { recursive: true });
  writeFileSync(wakeScriptPath, stamped, 'utf8');
  chmodSync(wakeScriptPath, 0o755);

  let legacyWrapperPath: string | null = null;
  if (opts.writeLegacyWrapper) {
    legacyWrapperPath =
      opts.legacyWrapperPath ?? join(bp.watchdogDir, deriveWakeName(opts.chainId));
    const wrapper = renderLegacyWakeWrapper(wakeScriptPath, opts.chainId);
    if (!opts.force && existsSync(legacyWrapperPath)) {
      throw new Error(
        `${legacyWrapperPath} already exists — pass --force to overwrite, or move it aside first`,
      );
    }
    mkdirSync(dirname(legacyWrapperPath), { recursive: true });
    writeFileSync(legacyWrapperPath, wrapper, 'utf8');
    chmodSync(legacyWrapperPath, 0o755);
  }

  return { wakeScriptPath, legacyWrapperPath, fingerprint };
}

interface StampOptions {
  chainId: string;
  templatePath: string;
}

/**
 * Insert the fingerprint comment as line 2 (immediately after the shebang).
 * The verifier strips this exact line before re-hashing, so placement
 * must be stable.
 */
export function stampWakeFingerprint(
  rendered: string,
  fingerprint: string,
  opts: StampOptions,
): string {
  const lines = rendered.split('\n');
  let insertAt = 0;
  if (lines[0]?.startsWith('#!')) {
    insertAt = 1;
  }
  const comment = `${WAKE_FINGERPRINT_COMMENT_PREFIX} ${fingerprint}`;
  const provenance = `# (chain=${opts.chainId} template=${opts.templatePath})`;
  lines.splice(insertAt, 0, comment, provenance);
  return lines.join('\n');
}

/**
 * 3-line wrapper that delegates to the canonical wake script. Existing
 * plists (which hard-code the watchdog-dir path) point at this file; it
 * execs the canonical, which carries the fingerprint stamp.
 *
 * Also re-emits the `--health-check` shim so the orphan-health-check
 * substrate (phase A2) keeps seeing a live response from the wrapper
 * path without needing to follow the exec.
 */
export function renderLegacyWakeWrapper(
  canonicalPath: string,
  chainId: string,
): string {
  return [
    '#!/bin/bash',
    `${WAKE_WRAPPER_COMMENT_PREFIX}${canonicalPath}`,
    `# Legacy wrapper for chain=${chainId} wake script.`,
    '# Canonical lives at the path above and is generated by',
    '# packages/chain-runner/bin/generate-wake.js. Do not edit either file',
    '# directly — re-run generate-wake.js or migrate-wakes-to-template.js.',
    '',
    '# Re-emit the A2 health-check shim from the wrapper so launchctl/health',
    '# probes can verify *this* path is reachable without following the exec.',
    'case "${1:-}" in',
    '  --health-check)',
    `    printf '{"ok":true,"label":"%s","script":"%s","git_sha":"%s","pid":%d,"timestamp":"%s","wrapper_target":"%s"}\\n' \\`,
    '      "${CAIA_PLIST_LABEL:-unknown}" "$0" "${CAIA_GIT_SHA:-unknown}" "$$" \\',
    '      "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" \\',
    `      "${canonicalPath}"`,
    '    exit 0',
    '    ;;',
    'esac',
    '',
    `exec "${canonicalPath}" "$@"`,
    '',
  ].join('\n');
}
