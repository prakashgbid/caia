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
