/**
 * Default ScanContext factory.
 *
 * Production code calls `defaultScanContext()` and overrides only what
 * it needs. Tests construct a ScanContext directly with mocked paths +
 * `runShell`.
 */

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ScanContext } from './types.js';

/**
 * The default real-shell runner. Uses `execFileSync` (not `execSync`)
 * to avoid shell-injection on the args array. Returns stdout (utf-8,
 * trimmed). Throws on non-zero exit.
 *
 * Timeout: 30s per command — long enough for `gh pr list` over a slow
 * network, short enough to bail on a hung command.
 */
export function defaultRunShell(cmd: string, args: string[]): string {
  const out = execFileSync(cmd, args, {
    encoding: 'utf-8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024
  });
  return out.trim();
}

export interface DefaultContextOptions {
  repoRoot?: string;
  memoryDir?: string;
  reportsDir?: string;
}

/**
 * Build a default ScanContext from env vars + sensible defaults.
 *
 * Defaults:
 *   - repoRoot:   process.cwd()
 *   - memoryDir:  $CAIA_MEMORY_DIR or <repoRoot>/agent/memory
 *   - reportsDir: $CAIA_REPORTS_DIR or $HOME/Documents/projects/reports
 */
export function defaultScanContext(opts: DefaultContextOptions = {}): ScanContext {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const memoryDir =
    opts.memoryDir ??
    process.env['CAIA_MEMORY_DIR'] ??
    join(repoRoot, 'agent', 'memory');
  const reportsDir =
    opts.reportsDir ??
    process.env['CAIA_REPORTS_DIR'] ??
    join(homedir(), 'Documents', 'projects', 'reports');

  return {
    repoRoot,
    memoryDir,
    reportsDir,
    runShell: defaultRunShell,
    env: process.env,
    now: () => new Date()
  };
}
