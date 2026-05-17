import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { detectNewExports } from './detect-new-exports.js';
import type {
  DetectNewPackagesOptions,
  DetectNewPackagesResult,
  GhPrFile,
  GhPrFilesResponse,
  NewExportRow,
  NewPackageDetail,
  NewPackageRow,
  ScanRow,
} from './types.js';

const DEFAULT_PREFIX = '@chiefaia/';
const PACKAGE_JSON_PATTERN = /^packages\/([^/]+)\/package\.json$/;

/**
 * Identify any top-level `packages/<X>/package.json` that the PR *added*
 * (not modified) whose `name` field begins with the configured prefix
 * (defaults to `@chiefaia/`).
 *
 * For each such package, parse `src/index.ts` via the phase-2 exports
 * detector. New packages have no prior snapshot on disk, so every export
 * comes back as "new" — that's the intended semantic.
 *
 * Returns flat `ScanRow[]` for downstream emit, plus a `newPackages` array
 * carrying the per-package detail (handy for tests and richer reports).
 */
export function detectNewPackages(
  pr: number,
  options: DetectNewPackagesOptions = {},
): DetectNewPackagesResult {
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error(`pr must be a positive integer, got ${pr}`);
  }

  const repoRoot = options.repoRoot ?? process.cwd();
  if (!isAbsolute(repoRoot)) {
    throw new Error(`repoRoot must be an absolute path, got ${repoRoot}`);
  }

  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const runGh = options.runGh ?? defaultRunGh;

  const response = runGh(pr);
  const addedPackageJsons = filterAddedPackageJsons(response.files);

  const newPackages: NewPackageDetail[] = [];
  const rows: ScanRow[] = [];

  for (const file of addedPackageJsons) {
    const detail = collectPackageDetail(file, repoRoot, prefix);
    if (detail === null) continue;

    newPackages.push(detail);

    const packageRow: NewPackageRow = {
      kind: 'new_package',
      packagePath: detail.packagePath,
      name: detail.name,
    };
    rows.push(packageRow);

    for (const exportRow of detail.exports) {
      const row: NewExportRow = {
        kind: 'new_export',
        packagePath: detail.packagePath,
        packageName: detail.name,
        identifier: exportRow.identifier,
        decl_kind: exportRow.decl_kind,
        isTypeOnly: exportRow.isTypeOnly,
      };
      rows.push(row);
    }
  }

  return { rows, newPackages };
}

function filterAddedPackageJsons(files: readonly GhPrFile[]): readonly GhPrFile[] {
  return files.filter(
    (f) => f.changeType === 'ADDED' && PACKAGE_JSON_PATTERN.test(f.path),
  );
}

function collectPackageDetail(
  file: GhPrFile,
  repoRoot: string,
  prefix: string,
): NewPackageDetail | null {
  const match = PACKAGE_JSON_PATTERN.exec(file.path);
  if (match === null) return null;

  const packagePath = `packages/${match[1]}`;
  const pkgJsonAbs = resolve(repoRoot, file.path);
  if (!existsSync(pkgJsonAbs)) {
    // PR is merged; package.json should exist on the working tree. If it
    // doesn't, the caller is scanning a checkout that doesn't include this
    // PR's tree — skip silently rather than emitting a half-filled row.
    return null;
  }

  const name = readPackageName(pkgJsonAbs);
  if (name === null || !name.startsWith(prefix)) {
    return null;
  }

  const indexAbs = resolve(repoRoot, packagePath, 'src', 'index.ts');
  if (!existsSync(indexAbs)) {
    return { packagePath, name, indexPath: null, exports: [] };
  }

  // New packages have no prior snapshot, so detectNewExports returns every
  // export as new on first run. We intentionally do NOT write the snapshot
  // here — that side-effect belongs to the scan-orchestrator (phase 5),
  // which decides when and whether to persist scan state.
  const result = detectNewExports(indexAbs, { writeSnapshot: false });
  return { packagePath, name, indexPath: indexAbs, exports: result.newExports };
}

function readPackageName(pkgJsonAbs: string): string | null {
  const raw = readFileSync(pkgJsonAbs, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null) return null;
  const name = (parsed as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

function defaultRunGh(pr: number): GhPrFilesResponse {
  const out = execFileSync('gh', ['pr', 'view', String(pr), '--json', 'files'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out) as unknown;
  if (!isGhPrFilesResponse(parsed)) {
    throw new Error(`gh pr view returned unexpected shape for PR ${pr}: ${out.slice(0, 200)}`);
  }
  return parsed;
}

function isGhPrFilesResponse(value: unknown): value is GhPrFilesResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { files?: unknown };
  if (!Array.isArray(v.files)) return false;
  return v.files.every(isGhPrFile);
}

function isGhPrFile(value: unknown): value is GhPrFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<GhPrFile>;
  return (
    typeof v.path === 'string' &&
    typeof v.changeType === 'string' &&
    typeof v.additions === 'number' &&
    typeof v.deletions === 'number'
  );
}
