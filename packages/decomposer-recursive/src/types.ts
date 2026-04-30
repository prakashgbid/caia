/**
 * Core types for the recursive decomposer.
 *
 * Every type here has a Zod-schema counterpart in `./schemas.ts` —
 * the schemas are the runtime source of truth for LLM-output
 * validation; these TypeScript types document the public API and
 * stay structurally compatible with the schemas.
 */

import type { StoryScope } from '@chiefaia/ticket-template';

export type { StoryScope } from '@chiefaia/ticket-template';
export { STORY_SCOPES, STORY_SCOPE_ORDER, isStoryScope } from '@chiefaia/ticket-template';

export interface ExistingArtifactRef {
  source: 'feature' | 'arch_artifact';
  id: string;
  name: string;
  score: number;
  hint?: string;
}

export interface ChildTicket {
  id: string;
  scope: StoryScope;
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  inScope: string[];
  outOfScope: string[];
  dependencies: string[];
  estimatedAtomic: boolean;
  existingArtifacts: ExistingArtifactRef[];
  lifecycle: 'new' | 'enhance' | 'reuse';
}

export interface ClarifyingQuestion {
  id: string;
  parentNodeId: string;
  question: string;
  proposedAnswers: string[];
  blocksBranch: boolean;
  rationale: string;
}

export interface DependencyEdge {
  fromChildId: string;
  toChildId: string;
  kind: 'blocks' | 'soft' | 'capability';
  rationale: string;
}

export interface AuditEntry {
  parentNodeId: string;
  parentScope: StoryScope;
  childScope: StoryScope;
  attempt: number;
  promptTextHash: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  alternativesConsidered: number;
  coverageScore: number | null;
  disjointnessScore: number | null;
  ambiguityDetected: boolean;
  questionsEmittedCount: number;
  decisionRationale: string;
  childrenCount: number;
  outcome: 'committed' | 'reflexive-retry' | 'stuck' | 'awaiting-clarification';
}

export interface Decomposition {
  childTickets: ChildTicket[];
  clarifyingQuestions: ClarifyingQuestion[];
  dependencies: DependencyEdge[];
  confidence: number | null;
  judgeScores: {
    coverage: number | null;
    disjointness: number | null;
  };
  audit: AuditEntry;
}

export interface ScopeDetection {
  targetScope: StoryScope;
  confidence: number;
  rationale: string;
  model: string;
  durationMs: number;
}

export interface AtomicityVerdict {
  atomic: boolean;
  confidence: number;
  rationale: string;
  failedCriteria: string[];
  model: string;
  durationMs: number;
}

export type CancellationSignal = AbortSignal;
