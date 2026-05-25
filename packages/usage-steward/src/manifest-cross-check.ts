/**
 * Cross-checker — joins scanner findings against per-package
 * expectations + the deploy manifest, emits CrossCheckObservation rows,
 * and builds the AttestationMatrix.
 *
 * Pure: no I/O. Takes (scannerResults, expectations, manifest) and
 * returns a fully-classified matrix.
 *
 * Decision rules (spec §4.1):
 *   - Every declared `expectedImport` must be satisfied by at least
 *     one resolved import path in the scanner findings; missing →
 *     declared-import-missing.
 *   - Every declared `expectedExport` must be reachable (not flagged
 *     `unused-export`); missing → declared-export-orphan.
 *   - Any `unused-file` / `orphan-module` finding against a package
 *     NOT in the deploy manifest → info-level undeclared-orphan
 *     (warning, not red).
 *   - Any `unused-file` / `orphan-module` finding against a package
 *     IN the deploy manifest → red (declared-shipped-but-unused).
 *   - knip-vs-ts-prune disagreement on the same symbol → scanner-disagreement.
 *   - All scanners absent → no-tooling.
 *   - All available scanners errored → unknown.
 */

import type {
  AttestationCell, AttestationMatrix, CrossCheckObservation,
  DeployManifest, ExpectedExport, ExpectedImport, PackageExpectations,
  ScannerKind, ScannerResult, ScannerToolingState, UsageFinding,
} from './types.js';

const ALL_SCANNERS: ReadonlyArray<ScannerKind> = ['knip', 'depcheck', 'ts-prune', 'dependency-cruiser'];

export interface CrossCheckInput {
  readonly packageName: string;
  readonly expectations: PackageExpectations;
  readonly scannerResults: ReadonlyArray<ScannerResult>;
}

export interface CrossCheckOptions {
  readonly manifest: DeployManifest;
}

/**
 * Cross-check one package. Returns its AttestationCell.
 */
export function crossCheckPackage(
  input: CrossCheckInput,
  opts: CrossCheckOptions,
): AttestationCell {
  const { packageName, expectations, scannerResults } = input;
  const shipped = new Set(opts.manifest.entries.map((e) => e.name));
  const isShipped = shipped.size > 0 && shipped.has(packageName);

  const scannerStates = buildScannerStates(scannerResults);
  const allFindings: UsageFinding[] = scannerResults.flatMap((r) => [...r.findings]);

  const observations: CrossCheckObservation[] = [];

  // — declared imports —
  let satisfiedImports = 0;
  for (const exp of expectations.expectedImports) {
    const supporting = findingsForImport(allFindings, exp, packageName);
    const missing = supporting.length > 0; // missing imports surface as 'unresolved-import' OR knip's 'unused-export' on the *exporter* side
    if (missing) {
      observations.push({
        packageName,
        observationKind: 'declared-import-missing',
        severity: exp.optional ? 'warn' : 'error',
        detail: `declared import \`${exp.symbol}\` from \`${exp.package ?? packageName}\` to consumer \`${exp.consumer}\` is missing`,
        expectedImport: exp,
        supportingFindings: supporting,
      });
    } else {
      observations.push({
        packageName,
        observationKind: 'declared-import-present',
        severity: 'info',
        detail: `declared import \`${exp.symbol}\` to \`${exp.consumer}\` is present`,
        expectedImport: exp,
        supportingFindings: [],
      });
      satisfiedImports += 1;
    }
  }

  // — declared exports —
  let reachableExports = 0;
  for (const exp of expectations.expectedExports) {
    const supporting = findingsForExport(allFindings, exp, packageName);
    if (supporting.length > 0) {
      observations.push({
        packageName,
        observationKind: 'declared-export-orphan',
        severity: exp.optional ? 'warn' : 'error',
        detail: `declared export \`${exp.symbol}\` flagged as orphan by ${supporting.map((f) => f.scanner).join(',')}`,
        expectedExport: exp,
        supportingFindings: supporting,
      });
    } else {
      observations.push({
        packageName,
        observationKind: 'declared-export-reachable',
        severity: 'info',
        detail: `declared export \`${exp.symbol}\` is reachable`,
        expectedExport: exp,
        supportingFindings: [],
      });
      reachableExports += 1;
    }
  }

  // — undeclared orphans + unused deps —
  let orphans = 0;
  const orphanFindings = allFindings.filter(
    (f) => f.kind === 'unused-file' || f.kind === 'orphan-module',
  );
  for (const f of orphanFindings) {
    orphans += 1;
    observations.push({
      packageName,
      observationKind: 'undeclared-orphan',
      severity: isShipped ? 'error' : 'warn',
      detail: f.message,
      supportingFindings: [f],
    });
  }

  let unusedDeps = 0;
  const depFindings = allFindings.filter(
    (f) => f.kind === 'unused-dependency' && f.severity !== 'info',
  );
  for (const f of depFindings) {
    unusedDeps += 1;
    observations.push({
      packageName,
      observationKind: 'undeclared-unused-dep',
      severity: 'warn',
      detail: f.message,
      supportingFindings: [f],
    });
  }

  let missingDeps = 0;
  const missingDepFindings = allFindings.filter(
    (f) => f.kind === 'missing-in-package-json' || f.kind === 'unlisted-dependency',
  );
  for (const f of missingDepFindings) {
    missingDeps += 1;
    observations.push({
      packageName,
      observationKind: 'undeclared-unused-dep',
      severity: 'error',
      detail: f.message,
      supportingFindings: [f],
    });
  }

  let circulars = 0;
  for (const f of allFindings.filter((f) => f.kind === 'circular-dependency')) {
    circulars += 1;
    observations.push({
      packageName,
      observationKind: 'undeclared-orphan',
      severity: 'error',
      detail: f.message,
      supportingFindings: [f],
    });
  }

  // — scanner disagreement —
  for (const dis of findScannerDisagreements(allFindings)) {
    observations.push({
      packageName,
      observationKind: 'scanner-disagreement',
      severity: 'warn',
      detail: dis.detail,
      supportingFindings: dis.supporting,
    });
  }

  // — tooling degradation —
  for (const s of ALL_SCANNERS) {
    if (scannerStates[s] === 'absent') {
      observations.push({
        packageName,
        observationKind: 'scanner-no-tooling',
        severity: 'info',
        detail: `scanner \`${s}\` not on PATH; cell degraded`,
        supportingFindings: [],
      });
    }
  }

  const status = classifyCell({
    scannerStates,
    observations,
  });

  return {
    packageName,
    solutionId: expectations.solutionId ?? null,
    status,
    expectedImportCount: expectations.expectedImports.length,
    satisfiedImportCount: satisfiedImports,
    expectedExportCount: expectations.expectedExports.length,
    reachableExportCount: reachableExports,
    orphanCount: orphans,
    unusedDepCount: unusedDeps,
    missingDepCount: missingDeps,
    circularDepCount: circulars,
    scannerStates,
    observations,
  };
}

/**
 * Aggregate per-package cells into the matrix.
 */
export function buildAttestationMatrix(
  cells: ReadonlyArray<AttestationCell>,
): AttestationMatrix {
  const map = new Map<string, AttestationCell>();
  const order: string[] = [];
  const sorted = [...cells].sort((a, b) => a.packageName.localeCompare(b.packageName));
  for (const c of sorted) {
    if (!map.has(c.packageName)) {
      map.set(c.packageName, c);
      order.push(c.packageName);
    }
  }
  return { cells: map, orderedPackages: order };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function classifyCell(input: {
  readonly scannerStates: Readonly<Record<ScannerKind, ScannerToolingState>>;
  readonly observations: ReadonlyArray<CrossCheckObservation>;
}): AttestationCell['status'] {
  const states = Object.values(input.scannerStates);
  const present = states.filter((s) => s === 'present').length;
  const absent = states.filter((s) => s === 'absent').length;
  const failed = states.filter((s) => s === 'failed').length;

  if (present === 0 && absent === ALL_SCANNERS.length) return 'no-tooling';
  if (present === 0 && failed > 0) return 'unknown';

  const anyError = input.observations.some((o) => o.severity === 'error');
  if (anyError) return 'red';
  const anyWarn = input.observations.some((o) => o.severity === 'warn');
  if (anyWarn) return 'yellow';
  return 'green';
}

export function countByStatus(matrix: AttestationMatrix): Record<AttestationCell['status'], number> {
  const out: Record<AttestationCell['status'], number> = {
    green: 0, yellow: 0, red: 0, 'no-tooling': 0, unknown: 0,
  };
  for (const c of matrix.cells.values()) out[c.status] += 1;
  return out;
}

function buildScannerStates(results: ReadonlyArray<ScannerResult>): Record<ScannerKind, ScannerToolingState> {
  const out: Record<ScannerKind, ScannerToolingState> = {
    'knip': 'absent', 'depcheck': 'absent', 'ts-prune': 'absent', 'dependency-cruiser': 'absent',
  };
  for (const r of results) out[r.scanner] = r.tooling;
  return out;
}

function findingsForImport(findings: ReadonlyArray<UsageFinding>, exp: ExpectedImport, ownerPkg: string): ReadonlyArray<UsageFinding> {
  const pkg = exp.package ?? ownerPkg;
  return findings.filter((f) => {
    if (f.kind !== 'unresolved-import' && f.kind !== 'unused-export') return false;
    if (f.dependency && f.dependency !== pkg) return false;
    if (f.symbol && exp.symbol && f.symbol !== exp.symbol) return false;
    return true;
  });
}

function findingsForExport(findings: ReadonlyArray<UsageFinding>, exp: ExpectedExport, _ownerPkg: string): ReadonlyArray<UsageFinding> {
  return findings.filter((f) => {
    if (f.kind !== 'unused-export' && f.kind !== 'unused-file') return false;
    if (f.symbol && f.symbol === exp.symbol) return true;
    return false;
  });
}

interface Disagreement { readonly detail: string; readonly supporting: ReadonlyArray<UsageFinding>; }

function findScannerDisagreements(findings: ReadonlyArray<UsageFinding>): ReadonlyArray<Disagreement> {
  // knip marks symbol X unused, ts-prune doesn't (or vice-versa) — we
  // group findings by (kind='unused-export', symbol) and emit a
  // disagreement when fewer than 2 scanners agree.
  const bySymbol = new Map<string, UsageFinding[]>();
  for (const f of findings) {
    if (f.kind !== 'unused-export') continue;
    if (!f.symbol) continue;
    const key = `${f.filePath ?? ''}::${f.symbol}`;
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key)!.push(f);
  }
  const out: Disagreement[] = [];
  for (const [key, group] of bySymbol) {
    const scanners = new Set(group.map((g) => g.scanner));
    if (scanners.size === 1 && (scanners.has('knip') || scanners.has('ts-prune'))) {
      // exactly one of {knip, ts-prune} flagged; the other did not.
      out.push({
        detail: `only \`${[...scanners][0]}\` flagged \`${key}\` as unused; cross-check tools disagree`,
        supporting: group,
      });
    }
  }
  return out;
}
