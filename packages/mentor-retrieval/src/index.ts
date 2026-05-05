/**
 * Mentor Phase-3 + Phase-4 retrieval — public surface.
 *
 * Phase 3:
 *   - PR-1: index builder + persistence + Ollama embedding wrapper.
 *   - PR-2: retrieval API + `caia-mentor-retrieve` CLI.
 *   - PR-3: orchestrator pre-spawn injection hook + `caia-mentor-prepend`
 *           CLI (the killer feature — spawned agents now arrive at
 *           their task with explicit warnings about prior failure
 *           modes).
 *
 * Phase 4:
 *   - PR-1: incident clustering (`./cluster.js`) +
 *           `caia-mentor-cluster` CLI.
 *   - PR-2: Steward rule proposal generator
 *           (`./steward-rule-proposer.js`) +
 *           `caia-mentor-propose-steward-rule` CLI.
 *   - PR-3: quarterly self-review (`./self-review.js`) +
 *           `caia-mentor-self-review` CLI. Aggregate health,
 *           classification breakdown, cluster shape, and
 *           Steward-rule coverage — Mentor's own track record.
 */

export {
  createOllamaEmbedder,
  extractEmbedding,
  vectorToBlob,
  blobToVector,
  DEFAULT_OLLAMA_URL,
  DEFAULT_EMBED_MODEL,
  type OllamaEmbedderOptions
} from './embed.js';

export {
  defaultFsReader,
  isFeedbackFile,
  isProposalFile,
  pathToSlug
} from './source-readers.js';

export {
  openIndexStore,
  indexDbPath,
  INDEX_DB_FILENAME,
  SNIPPET_MAX_BYTES,
  type IndexStore,
  type IndexStoreOptions
} from './index-store.js';

export {
  buildIndex,
  sha256Hex,
  snippet,
  type BuildIndexOptions
} from './index-builder.js';

export {
  retrieveLessons,
  cosineSimilarity,
  formatLessonsPreamble,
  DEFAULT_TOP_N,
  DEFAULT_MIN_SIMILARITY,
  type RetrievedLesson,
  type RetrieveLessonsOptions
} from './retrieve.js';

export {
  prependLessons,
  type PrependLessonsOptions,
  type PrependLessonsResult
} from './prepend.js';

export {
  clusterProposals,
  parseProposalSlug,
  stripCollisionSuffix,
  systemicClusters,
  DEFAULT_SYSTEMIC_THRESHOLD,
  DEFAULT_BURST_WINDOW_MS,
  type Cluster,
  type ClusterOptions,
  type ProposalMetadata
} from './cluster.js';

export {
  proposeStewardRule,
  renderStewardRuleProposalMarkdown,
  writeStewardRuleProposals,
  type StewardRuleProposal,
  type WriteStewardRuleProposalsOptions,
  type WriteStewardRuleProposalsResult
} from './steward-rule-proposer.js';

export {
  generateSelfReview,
  renderSelfReviewMarkdown,
  DEFAULT_WINDOW_DAYS,
  DEFAULT_TOP_CLUSTERS,
  type SelfReviewOptions,
  type SelfReviewSnapshot,
  type SelfReviewMetaInput,
  type ClassificationBreakdownRow,
  type TopClusterRow
} from './self-review.js';

export type {
  BuildIndexStats,
  EmbedResult,
  Embedder,
  FsReader,
  IndexedLesson,
  LessonKind,
  SourceFile
} from './types.js';
