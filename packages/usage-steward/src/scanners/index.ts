/**
 * Scanner registry — picks the right wrapper for each ScannerKind and
 * exposes a `defaultScannerRunner` callers can hand to `run`.
 */
import type { ScannerKind, ScannerResult, ScannerRunner } from '../types.js';
import { runKnip } from './knip.js';
import { runDepcheck } from './depcheck.js';
import { runTsPrune } from './ts-prune.js';
import { runDependencyCruiser } from './dependency-cruiser.js';

export * from './spawn.js';
export * from './knip.js';
export * from './depcheck.js';
export * from './ts-prune.js';
export * from './dependency-cruiser.js';

export const ALL_SCANNERS: ReadonlyArray<ScannerKind> = [
  'knip',
  'depcheck',
  'ts-prune',
  'dependency-cruiser',
] as const;

export const defaultScannerRunner: ScannerRunner = async (scanner, packageDir, opts) => {
  switch (scanner) {
    case 'knip':
      return runKnip(packageDir, opts);
    case 'depcheck':
      return runDepcheck(packageDir, opts);
    case 'ts-prune':
      return runTsPrune(packageDir, opts);
    case 'dependency-cruiser':
      return runDependencyCruiser(packageDir, opts);
    default: {
      const _exhaustive: never = scanner;
      throw new Error(`unknown scanner: ${String(_exhaustive)}`);
    }
  }
};

/** Run every scanner in parallel against one package. Order preserved. */
export async function runAllScanners(
  packageDir: string,
  scanners: ReadonlyArray<ScannerKind> = ALL_SCANNERS,
  opts: { timeoutMs?: number; signal?: AbortSignal; runner?: ScannerRunner } = {},
): Promise<ReadonlyArray<ScannerResult>> {
  const runner = opts.runner ?? defaultScannerRunner;
  const results = await Promise.all(
    scanners.map((s) =>
      runner(s, packageDir, { ...(opts.signal !== undefined ? { signal: opts.signal } : {}), ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) }).catch((err: unknown) => ({
        scanner: s,
        tooling: 'failed' as const,
        findings: [],
        durationMs: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
      })),
    ),
  );
  return results;
}
