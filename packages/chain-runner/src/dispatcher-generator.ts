// B3 (integration-remediation-b phase 3, 2026-05-15). Generate per-chain
// run-phase dispatchers from the canonical template + stamp the embedded
// fingerprint.
//
// CLI entry: bin/generate-run-phase.js → calls into generateDispatcher().
//
// Output layout (canonical):
//   ~/.caia/dispatchers/<chain-id>.sh         (the real dispatcher)
//   ~/Documents/projects/agent-memory/_<slug>_run_phase.sh  (3-line wrapper)
//
// The wrapper preserves the existing wake-script invariant (wake.sh has
// the dispatcher path baked in at template-render time, so re-pointing
// would require regenerating every chain's wake.sh — that lands in B4).
// Until then, wake.sh execs the wrapper → wrapper execs the canonical →
// chain-runner's fingerprint guardrail follows the wrapper marker.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isoNow } from './time.js';
import { fingerprintTemplate, FINGERPRINT_COMMENT_PREFIX, WRAPPER_COMMENT_PREFIX } from './dispatcher-fingerprint.js';
import { deriveLogSlug, derivePhaseLogDir, deriveRunnerName, renderTemplate, defaultBootstrapPaths } from './bootstrap-chain.js';
import type { TemplateContext } from './bootstrap-chain.js';

export interface GenerateDispatcherOptions {
  chainId: string;
  phasesYaml: string;
  /** Override the output path. Defaults to ~/.caia/dispatchers/<chain-id>.sh. */
  out?: string;
  /** Override the log dir baked into the dispatcher. */
  logDir?: string;
  /** Override the canonical template path. Defaults to bin/templates/run-phase.sh.template. */
  templatePath?: string;
  /** Override the caia-chain.js path. */
  caiaChainBin?: string;
  /** When true, also write the legacy wrapper at agent-memory/_<slug>_run_phase.sh. */
  writeLegacyWrapper?: boolean;
  /** Override the legacy wrapper path. Defaults to the standard agent-memory path. */
  legacyWrapperPath?: string;
  /** Allow overwriting an existing output file. */
  force?: boolean;
}

export interface GenerateDispatcherResult {
  dispatcherPath: string;
  legacyWrapperPath: string | null;
  fingerprint: string;
}

function defaultDispatchersDir(): string {
  return join(homedir(), '.caia', 'dispatchers');
}

function defaultTemplatePath(): string {
  // Resolve relative to this module — works both from src/ (tests) and dist/.
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = pathResolve(here, '..');
  const fromDist = pathResolve(pkgRoot, 'bin', 'templates', 'run-phase.sh.template');
  if (existsSync(fromDist)) return fromDist;
  return pathResolve(dirname(pkgRoot), 'bin', 'templates', 'run-phase.sh.template');
}

/**
 * Load the canonical template body. Exposed so the dispatch-time guardrail
 * and tests can share a single source of truth.
 */
export function loadCanonicalTemplate(templatePath?: string): {
  templateBody: string;
  templatePath: string;
} {
  const tp = templatePath ?? defaultTemplatePath();
  return { templateBody: readFileSync(tp, 'utf8'), templatePath: tp };
}

/**
 * Compute the fingerprint of the currently-bundled canonical template.
 * Cheap (one read + one hash) — call sites in the dispatch path memoize it.
 */
export function canonicalTemplateFingerprint(templatePath?: string): string {
  return fingerprintTemplate(loadCanonicalTemplate(templatePath).templateBody);
}

/**
 * Render the template for `chainId`, prepend the fingerprint comment, and
 * write to disk. Returns the absolute path(s) written + the fingerprint
 * stamped.
 */
export function generateDispatcher(
  opts: GenerateDispatcherOptions,
): GenerateDispatcherResult {
  const { templateBody, templatePath } = loadCanonicalTemplate(opts.templatePath);
  const fingerprint = fingerprintTemplate(templateBody);

  const home = homedir();
  const bp = defaultBootstrapPaths();
  const dispatcherPath = opts.out ?? join(defaultDispatchersDir(), `${opts.chainId}.sh`);
  const logDir = opts.logDir ?? derivePhaseLogDir(home, opts.chainId);
  const caiaChainBin = opts.caiaChainBin ?? bp.caiaChainBin;

  // Render. The template uses {{CHAIN_ID}}, {{PHASES_FILE}}, {{CAIA_CHAIN_BIN}},
  // {{PHASE_LOG_DIR}}, {{GENERATED_AT}}. We satisfy every placeholder declared
  // in TemplateContext even if some are unused by this particular template, so
  // renderTemplate doesn't throw on a missing binding.
  const ctx: TemplateContext = {
    CHAIN_ID: opts.chainId,
    PHASES_FILE: opts.phasesYaml,
    RUNNER_SCRIPT: dispatcherPath,
    CAIA_CHAIN_BIN: caiaChainBin,
    LOG_SLUG: deriveLogSlug(opts.chainId),
    PHASE_LOG_DIR: logDir,
    HOME: home,
    LABEL: `com.caia.chain-runner.${opts.chainId}`,
    WAKE_SCRIPT: '',
    SCHEDULE_BLOCK: '',
    GENERATED_AT: isoNow(),
  };

  const rendered = renderTemplate(templateBody, ctx);

  // Stamp the fingerprint as the second line, right after the shebang.
  const stamped = stampFingerprint(rendered, fingerprint, {
    chainId: opts.chainId,
    templatePath,
  });

  if (!opts.force && existsSync(dispatcherPath)) {
    throw new Error(
      `${dispatcherPath} already exists — pass --force to overwrite, or move it aside first`,
    );
  }
  mkdirSync(dirname(dispatcherPath), { recursive: true });
  writeFileSync(dispatcherPath, stamped, 'utf8');
  chmodSync(dispatcherPath, 0o755);

  let legacyWrapperPath: string | null = null;
  if (opts.writeLegacyWrapper) {
    legacyWrapperPath =
      opts.legacyWrapperPath ?? join(bp.runnerDir, deriveRunnerName(opts.chainId));
    const wrapper = renderLegacyWrapper(dispatcherPath, opts.chainId);
    if (!opts.force && existsSync(legacyWrapperPath)) {
      throw new Error(
        `${legacyWrapperPath} already exists — pass --force to overwrite, or move it aside first`,
      );
    }
    mkdirSync(dirname(legacyWrapperPath), { recursive: true });
    writeFileSync(legacyWrapperPath, wrapper, 'utf8');
    chmodSync(legacyWrapperPath, 0o755);
  }

  return { dispatcherPath, legacyWrapperPath, fingerprint };
}

interface StampOptions {
  chainId: string;
  templatePath: string;
}

/**
 * Insert the fingerprint comment as line 2 (immediately after the shebang).
 * The verifier strips this exact line before re-hashing, so its placement
 * must be stable.
 */
export function stampFingerprint(
  rendered: string,
  fingerprint: string,
  opts: StampOptions,
): string {
  const lines = rendered.split('\n');
  // Locate the shebang. If absent (defensive — every template starts with
  // `#!/bin/bash`), prepend.
  let insertAt = 0;
  if (lines[0]?.startsWith('#!')) {
    insertAt = 1;
  }
  const comment = `${FINGERPRINT_COMMENT_PREFIX} ${fingerprint}`;
  const provenance = `# (chain=${opts.chainId} template=${opts.templatePath})`;
  lines.splice(insertAt, 0, comment, provenance);
  return lines.join('\n');
}

/**
 * 3-line wrapper that delegates to the canonical dispatcher. Wake scripts
 * point at this file (path is baked into the rendered wake.sh).
 */
export function renderLegacyWrapper(
  canonicalPath: string,
  chainId: string,
): string {
  // The wrapper marker tells the dispatch-time fingerprint guardrail to
  // resolve to `canonicalPath` and verify *its* fingerprint instead of
  // expecting a CAIA_DISPATCHER_FINGERPRINT line on the wrapper itself.
  return [
    '#!/bin/bash',
    `${WRAPPER_COMMENT_PREFIX}${canonicalPath}`,
    `# Legacy wrapper for chain=${chainId}.`,
    '# The canonical dispatcher lives at the path above and is generated by',
    '# packages/chain-runner/bin/generate-run-phase.js. Do not edit either file',
    '# directly — the fingerprint guardrail will refuse to dispatch on drift.',
    `exec "${canonicalPath}" "$@"`,
    '',
  ].join('\n');
}
