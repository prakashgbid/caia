/**
 * @caia/ea-research-conductor — public types.
 *
 * Reference: spec §4.4. The Conductor is advisory in the EA precedence
 * ladder — it never blocks an approval.
 */

import type { FsAdapter } from '@caia/ea-architect';

/** Caller's request to initiate research. */
export interface ResearchRequest {
  /** Free-text topic. */
  topic: string;
  /** Detailed brief — what specifically to investigate. */
  brief: string;
  /** Requesting agent id (e.g. '@caia/ea-plan-reviewer' or 'operator-direct'). */
  requesterAgentId: string;
  /** Optional priority hint. */
  priority?: 'low' | 'medium' | 'high';
}

/** Dedup-check result. */
export interface DedupCheckResult {
  isDuplicate: boolean;
  /** If duplicate, the existing research path. */
  existingPath?: string;
  /** Confidence the match is real (0..1). */
  confidence: number;
  /** Reason summary. */
  reason: string;
}

/** Dispatch verdict. */
export interface ResearchDispatchVerdict {
  /** Topic slug derived from the request. */
  topicSlug: string;
  /** Was a research subagent actually dispatched? */
  dispatched: boolean;
  /** Path to the research-log entry. */
  logPath: string;
  /** Why dispatch was skipped, if applicable. */
  skippedReason?: string;
  /** ISO timestamp. */
  dispatchedAtIso: string;
}

export interface ResearchConductorConfig {
  /** Root of the EA repository. */
  repositoryPath?: string;
  /** Filesystem adapter. */
  fs?: FsAdapter;
  /** Clock. */
  clock?: () => Date;
  /** Dispatcher adapter — swappable for tests. */
  dispatcher?: ResearchDispatcherAdapter;
}

/** Spawns a research subagent. Production wires to @chiefaia/claude-spawner. */
export interface ResearchDispatcherAdapter {
  dispatch(input: { topicSlug: string; request: ResearchRequest }): Promise<{ ok: boolean; sessionId?: string; diagnostic?: string }>;
}
