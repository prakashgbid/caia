export {
  findLiteralCandidates,
  parseIdentifierOverrides,
} from './literal-pattern.js';
export type {
  ArtefactKind,
  ArtefactRow,
  LiteralCandidate,
  LiteralConfidence,
  LiteralPatternOptions,
} from './literal-pattern.js';

export {
  scoreCandidates,
  computeUniqueness,
  computeFrequencyWeight,
  computeScore,
  applyMaxCandidates,
  countExportingPackages,
  countTotalHits,
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_PACKAGE_SCOPE,
  DEFAULT_PACKAGES_DIRS,
} from './score.js';
export type {
  ScoredCandidate,
  ArtefactScoring,
  ScoreCandidatesResult,
  ScoreCandidatesOptions,
} from './score.js';
