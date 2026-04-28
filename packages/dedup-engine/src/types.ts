export type DedupDecision = 'new' | 'similar_concept' | 'related' | 'overlap' | 'likely_duplicate' | 'duplicate';

export interface SimilarItem {
  id: string;
  title: string;
  description?: string;
  similarity: number;  // 0-1
  sharedLabels?: string[];
}

export interface DedupResult {
  decision: DedupDecision;
  confidence: number;  // 0-1
  similarItems: SimilarItem[];
  recommendations: string[];
  reasoning: string;
  shouldBlock: boolean;  // true for duplicate, likely_duplicate
  shouldWarn: boolean;   // true for overlap
}

export interface DedupCandidate {
  id: string;
  title: string;
  description?: string;
  labels?: string[];
  createdAt?: number;
}

export interface DedupEngineConfig {
  // Similarity thresholds
  duplicateThreshold?: number;        // default: 0.92
  likelyDuplicateThreshold?: number;  // default: 0.80
  overlapThreshold?: number;          // default: 0.65
  relatedThreshold?: number;          // default: 0.50
  // Temporal decay: old completed items treated as fresh after N days
  temporalDecayDays?: number;         // default: 180
  // Scope
  projectScoped?: boolean;            // default: true (only compare within same project)
}
