export { check } from './engine';
export type { DedupCandidate, DedupResult, DedupDecision, DedupEngineConfig, SimilarItem } from './types';
export { jaccardSimilarity, labelOverlapScore, combinedScore } from './similarity';
