/**
 * Public types for the adoption-enforcement scan subsystem.
 *
 * Phase 2 (new-exports detector) — feeds the post-merge adoption scan stage.
 * Companion design: agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md.
 */

export type DeclKind =
  | 'function'
  | 'class'
  | 'const'
  | 'let'
  | 'var'
  | 'interface'
  | 'type'
  | 'enum'
  | 'default'
  | 're-export'
  | 'namespace-re-export';

export interface ExportRow {
  /** The exported identifier as seen by consumers (the `baz` in `export { bar as baz }`). */
  readonly identifier: string;
  /** Kind of declaration that introduced the export. */
  readonly decl_kind: DeclKind;
  /** True if this export carries no runtime value (interface/type/`export type` re-export). */
  readonly isTypeOnly: boolean;
}

export interface DetectNewExportsResult {
  /** Every top-level export found in the index.ts. */
  readonly exports: readonly ExportRow[];
  /** Subset of `exports` that did not appear in the prior snapshot (or all, on first run). */
  readonly newExports: readonly ExportRow[];
  /** Absolute path to the snapshot file (read and rewritten). */
  readonly snapshotPath: string;
  /** True when no snapshot existed before this call — every export is treated as new. */
  readonly firstRun: boolean;
}

export interface DetectNewExportsOptions {
  /**
   * Override the default snapshot path (`<pkgRoot>/.adoption/exports-snapshot.json`).
   * Useful for tests.
   */
  readonly snapshotPath?: string;
  /**
   * When false, skip writing the snapshot back. Defaults to true.
   * Useful for dry-runs and tests that want to inspect repeatedly.
   */
  readonly writeSnapshot?: boolean;
}

export interface ExportsSnapshot {
  readonly version: 1;
  readonly indexPath: string;
  readonly capturedAt: string;
  readonly exports: readonly ExportRow[];
}

/**
 * One row in a `gh pr view <pr> --json files` response. Only the fields the
 * scan layer consumes are typed — extra fields are tolerated.
 */
export interface GhPrFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  /** `ADDED` | `MODIFIED` | `RENAMED` | `REMOVED` | `COPIED` — exact set varies by gh version. */
  readonly changeType: string;
}

export interface GhPrFilesResponse {
  readonly files: readonly GhPrFile[];
}

export interface DetectNewPackagesOptions {
  /** Repo root the gh paths are relative to. Defaults to `process.cwd()`. */
  readonly repoRoot?: string;
  /** Package-name prefix that qualifies a "@chiefaia/" workspace. Defaults to `@chiefaia/`. */
  readonly prefix?: string;
  /**
   * Injection point for tests. When supplied, replaces the real
   * `gh pr view <pr> --json files` invocation. Receives the PR number,
   * must return a parsed `GhPrFilesResponse`.
   */
  readonly runGh?: (pr: number) => GhPrFilesResponse;
}

/**
 * Detector output row tagged for the post-merge `caia-adoption-run scan`
 * pipeline. Two row kinds share the discriminator `kind`.
 */
export type ScanRow = NewPackageRow | NewExportRow;

export interface NewPackageRow {
  readonly kind: 'new_package';
  /** Repo-root-relative dir, e.g. `packages/foo`. */
  readonly packagePath: string;
  /** `name` field from the added `package.json`. */
  readonly name: string;
}

export interface NewExportRow {
  readonly kind: 'new_export';
  /** Repo-root-relative dir, e.g. `packages/foo`. */
  readonly packagePath: string;
  /** Owning package name (the `name` field from `package.json`). */
  readonly packageName: string;
  readonly identifier: string;
  readonly decl_kind: DeclKind;
  readonly isTypeOnly: boolean;
}

export interface NewPackageDetail {
  readonly packagePath: string;
  readonly name: string;
  /** Absolute path to the package's `src/index.ts` — `null` if missing. */
  readonly indexPath: string | null;
  readonly exports: readonly ExportRow[];
}

export interface DetectNewPackagesResult {
  readonly rows: readonly ScanRow[];
  readonly newPackages: readonly NewPackageDetail[];
}
