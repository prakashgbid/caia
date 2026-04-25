export type PriorityBucket = 'P0' | 'P1' | 'P2' | 'P3';

export interface ScoringDimensions {
  urgency: number;        // 0-1 — user-blocked / blocks-production
  blastRadius: number;    // 0-1 — weighted dependent count
  userVisible: number;    // 0-1 — impacts UI/UX directly
  riskIfDelayed: number;  // 0-1 — security, data, integrity
  effortInverse: number;  // 0-1 — inverted effort (bigger = lower)
  confidence: number;     // 0-1 — spec clarity
  domainCriticality: number; // 0-1 — domain tier weight
}

export interface PriorityRationale {
  dimensions: ScoringDimensions;
  score: number;
  bucket: PriorityBucket;
  summary: string;
  hardBlockerOverride: boolean;
}

export interface ScoredTask {
  taskId: string;
  score: number;
  bucket: PriorityBucket;
  positionOrdinal: number;
  rationale: PriorityRationale;
}

export interface PrioritizeResult {
  taskId: string;
  score: number;
  bucket: PriorityBucket;
  positionOrdinal: number;
  rationale: PriorityRationale;
  previousScore: number | null;
  previousBucket: string | null;
}

// Input context fed to the scorer (derived from DB queries)
export interface TaskScoringContext {
  id: string;
  title: string;
  domainSlug: string | null;
  declaredFiles: string[];
  notes: string | null;
  dependsOn: string[];         // task IDs this task depends on
  dependentCount: number;      // how many tasks depend on THIS one
  openBlockerCount: number;    // open blockers for this task
  currentScore: number | null;
  currentBucket: string | null;
  currentOrdinal: number | null;
}
