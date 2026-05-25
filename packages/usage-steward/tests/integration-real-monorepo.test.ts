/**
 * Integration test against the real caia monorepo.
 *
 * Purpose: exercise the full pipeline (manifest loader + scanner runner
 * + cross-checker + attestation writer) against the live packages/
 * tree to surface the 30+ ship-and-forget packages identified in the
 * 2026-05-20 stack-teardown lesson.
 *
 * Determinism: the test does NOT spawn the real scanner binaries (knip
 * etc.) — that would be flaky in CI and slow on laptops. Instead it:
 *
 *   1. Loads every real package via `loadPackageExpectations`.
 *   2. Injects a synthetic `ScannerRunner` that flags any package whose
 *      package.json has zero dependencies (a heuristic proxy for
 *      "probably never imported by anything") as an orphan.
 *   3. Asserts the run completes, writes its JSONL log, and surfaces
 *      at least 1 yellow/red attestation (the lesson's premise).
 *
 * The test is skipped automatically when not run against the canonical
 * monorepo path (so it doesn't fail in CI sandboxes).
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import type { ScannerKind, ScannerResult, ScannerRunner, UsageFinding } from '../src/types.js';

const CAIA_PACKAGES_ROOT = path.join(os.homedir(), 'Documents/projects/caia/packages');

let TMP: string;
beforeEach(async () => { TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'us-integration-')); });
afterEach(async () => { await fs.rm(TMP, { recursive: true, force: true }); });

const heuristicRunner: ScannerRunner = async (scanner: ScannerKind, packageDir: string): Promise<ScannerResult> => {
  // For determinism we only emit findings from `knip`-position; the
  // other three scanners no-op. The knip-position finding is a
  // synthetic "this package has no dependencies declared in
  // package.json" check — a cheap proxy for "ship-and-forget".
  if (scanner !== 'knip') {
    return { scanner, tooling: 'present', findings: [], durationMs: 0 };
  }
  let pkg: { dependencies?: Record<string, unknown>; name?: string } = {};
  try {
    pkg = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'));
  } catch {
    return { scanner, tooling: 'present', findings: [], durationMs: 0 };
  }
  const findings: UsageFinding[] = [];
  if (!pkg.dependencies || Object.keys(pkg.dependencies).length === 0) {
    findings.push({
      scanner: 'knip', kind: 'unused-file', severity: 'error',
      packageName: pkg.name ?? null, filePath: path.join(packageDir, 'src/index.ts'),
      symbol: null, dependency: null,
      message: 'no runtime dependencies declared — candidate ship-and-forget',
      raw: { dependencies: pkg.dependencies ?? null },
    });
  }
  return { scanner, tooling: 'present', findings, durationMs: 0 };
};

describe('integration: real caia monorepo', () => {
  it('runs end-to-end against the real packages tree and surfaces candidate ship-and-forget findings', async () => {
    let exists = false;
    try {
      const stat = await fs.stat(CAIA_PACKAGES_ROOT);
      exists = stat.isDirectory();
    } catch { /* ignore */ }
    if (!exists) {
      // Skip silently in environments that don't have the monorepo.
      // (Vitest doesn't have ctx.skip in flat config; we just assert
      // that path-checks themselves work.)
      expect(exists).toBe(false);
      return;
    }

    const runsJsonl = path.join(TMP, 'runs.jsonl');
    const statusJson = path.join(TMP, 'status.json');
    const attestJsonl = path.join(TMP, 'attestations.jsonl');
    const inbox = path.join(TMP, 'INBOX.md');

    const result = await run({
      packagesRoot: CAIA_PACKAGES_ROOT,
      runsJsonlPath: runsJsonl,
      statusJsonPath: statusJson,
      attestationsJsonlPath: attestJsonl,
      inboxPath: inbox,
      deployManifestPath: path.join(TMP, 'no-manifest.yaml'), // empty → every pkg is in scope
      runScanner: heuristicRunner,
      quiet: true,
    });

    // We must have scanned a real, non-trivial monorepo.
    expect(result.run.attestations.length).toBeGreaterThan(30);

    // The heuristic should flag at least one package as yellow (no
    // deps → likely ship-and-forget). The exact count depends on the
    // monorepo at scan time; we just assert ≥1 to keep the test stable.
    const yellowOrRed = result.run.summary.yellow + result.run.summary.red;
    expect(yellowOrRed).toBeGreaterThan(0);

    // The audit JSONL + status snapshot must have been written.
    const runsText = await fs.readFile(runsJsonl, 'utf8');
    expect(runsText.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1);
    const statusText = await fs.readFile(statusJson, 'utf8');
    const snapshot = JSON.parse(statusText) as { latestRunId: string; summary: { green: number } };
    expect(snapshot.latestRunId).toBe(result.run.runId);
  }, 90_000);
});
