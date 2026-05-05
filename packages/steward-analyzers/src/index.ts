/**
 * @chiefaia/steward-analyzers — public API.
 *
 * See `src/migration-linter.ts` for the first analyzer; future analyzers
 * (graph-divergence, migration-numbering, …) will export from here.
 */

export type { Finding, AnalyzerResult, Severity } from './types.js';
export { exitCodeFor } from './types.js';

export {
  lintMigrations,
  parseSql,
  loadJournal,
  discoverMigrationRoots,
  type LintMigrationsOptions,
  type ParsedSqlFile,
  type JournalEntry,
  type JournalFile,
} from './migration-linter.js';
export {
  checkMigrationNumbering,
  nextFreePrefix,
  type CheckMigrationNumberingOptions,
} from './migration-numbering.js';

export {
  checkGraphDivergence,
  type GraphDivergenceInput,
} from './graph-divergence.js';

export {
  checkSnapshotAge,
  checkTokenExpiry,
  checkAuditLogRotation,
  type CheckSnapshotAgeOptions,
  type CheckTokenExpiryOptions,
  type CheckAuditLogRotationOptions,
  type SnapshotEntry,
  type SecretRecord,
  type AuditLogState,
} from './vault-state.js';

export {
  checkStashCount,
  checkWorktreeCount,
  checkOrphanBranches,
  preflightChecks,
  type CheckStashCountOptions,
  type CheckWorktreeCountOptions,
  type CheckOrphanBranchesOptions,
  type WorktreeEntry,
  type OrphanBranchInput,
  type PreflightInput,
  type PreflightOptions,
} from './local-state.js';

export {
  checkPrStaleness,
  checkDependabotTriage,
  groupDependabotByEcosystem,
  type CheckPrStalenessOptions,
  type CheckDependabotTriageOptions,
  type PrRecord,
  type DependabotPrRecord,
} from './pr-state.js';

export {
  checkLocalPreviewHealth,
  type CheckLocalPreviewHealthOptions,
  type SiteStateInput,
} from './local-preview-health.js';
