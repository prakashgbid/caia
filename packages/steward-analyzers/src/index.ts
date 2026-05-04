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
