/**
 * @caia/ea-doc-steward — public type surface.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §4.5.
 */

import type { AdrRecord, EaRepository, FsAdapter, NewAdrDraft } from '@caia/ea-architect';

/** Input from the Coordinator after Plan Reviewer approves a submission. */
export interface StewardFilingInput {
  /** Loaded EA Repository (the Coordinator has already loaded it). */
  repo: EaRepository;
  /** New ADR drafts approved by the Reviewer. */
  newAdrsToFile: NewAdrDraft[];
  /** Existing ADRs the new drafts affect (amend / supersede). */
  affectedExistingAdrs: import('@caia/ea-architect').AffectedAdr[];
  /** Dialogue log for the submission — used to extract Consequences text. */
  dialogueLogPath?: string;
  /** Submission id for traceability. */
  submissionId: string;
  /** Filesystem adapter (default node:fs). */
  fs?: FsAdapter;
  /** Clock — for deterministic tests. */
  clock?: () => Date;
}

/** Output from a single filing run. */
export interface StewardFilingOutput {
  /** Each newly-filed ADR: id + path + numeric id. */
  filedAdrs: FiledAdrRef[];
  /** Pairs of (old, new) for which supersession links were updated. */
  supersessionsApplied: Array<{ supersededAdr: string; bySupersedingAdr: string }>;
  /** True iff INDEX.md was updated. */
  indexUpdated: boolean;
  /** Validation result on the supersession graph after filing. */
  supersessionGraph: SupersessionGraphValidation;
}

export interface FiledAdrRef {
  adrId: string;
  title: string;
  filePath: string;
  id: number;
}

/** Validation result for the supersession graph (cycles / orphans / unidirectional links). */
export interface SupersessionGraphValidation {
  ok: boolean;
  cycles: string[][]; // sequences of ADR ids forming a cycle
  orphanedSupersedes: Array<{ adrId: string; supersededId: string }>; // says it supersedes X but X doesn't exist
  unidirectionalLinks: Array<{ from: string; to: string }>; // X says it supersedes Y but Y is not marked
  /** Count of ADRs scanned. */
  scannedCount: number;
}

/** Result of an INDEX maintenance pass. */
export interface IndexMaintenanceResult {
  /** Path to each INDEX.md updated. */
  indexesUpdated: string[];
  /** Entries added / removed. */
  added: number;
  removed: number;
}

/** Stale-ADR finding (repo-freshness pass). */
export interface StaleAdrFinding {
  adrId: string;
  filePath: string;
  reason: 'no-status' | 'status-malformed' | 'no-affected-components' | 'broken-supersession';
  detail: string;
}

/** Output of a freshness pass — does NOT modify files; reports only. */
export interface FreshnessReport {
  scannedCount: number;
  stale: StaleAdrFinding[];
  /** Timestamp the pass ran. */
  ranAtIso: string;
}

/** Steward config. */
export interface DocStewardConfig {
  fs?: FsAdapter;
  clock?: () => Date;
}

/** Used to build INDEX.md entries. */
export interface IndexEntry {
  adrId: string;
  title: string;
  status: string;
  /** Relative path from the INDEX.md directory. */
  relativePath: string;
}

/** Re-export AdrRecord so callers don't need to import from ea-architect for steward output. */
export type { AdrRecord };
