/**
 * @chiefaia/apprentice-corpus — public surface.
 *
 * The aggregator is the primary entry point. Everything else is exposed
 * for testability + downstream Phase 1/2 packages that may want to
 * reuse the schema, classifiers, or scoring heuristics directly.
 *
 * Option E shape: every export is parameterised; the only way to bond
 * to CAIA is via the constructor's defaults (which read env vars
 * + fall back to canonical CAIA paths).
 */

export { ApprenticeCorpusAggregator } from './aggregator.js';

export {
  resolveConfig,
  expandHome,
  snapshotConfigForHash,
  type ApprenticeCorpusConfig,
  type ResolvedApprenticeCorpusConfig
} from './config.js';

export {
  defaultFsReader
} from './fs-reader.js';

export {
  classifyMemoryFile,
  parseMarkdown,
  isEligibleMarkdown,
  createMemoryWalker,
  type ParsedMarkdown,
  type MemoryWalkerOptions
} from './memory-walker.js';

export {
  createReportsWalker,
  type ReportsWalkerOptions
} from './reports-walker.js';

export {
  createEventBusReader,
  defaultEventBusClient,
  projectEventToText,
  type EventBusReaderOptions
} from './event-bus-reader.js';

export {
  createGithubReader,
  defaultGithubClient,
  formatPrText,
  type GithubReaderOptions
} from './github-reader.js';

export {
  createLangfuseReader,
  defaultLangfuseClient,
  formatTraceText,
  type LangfuseReaderOptions
} from './langfuse-reader.js';

export {
  CAIA_SYSTEM_PROMPT
} from './system-prompt.js';

export {
  instructionFor,
  buildResponse,
  normaliseOne,
  normaliseAll,
  sha256OfMessages,
  type NormaliserOptions
} from './normaliser.js';

export {
  applyPiiMask,
  DEFAULT_REDACT_PATTERNS,
  type RedactPattern,
  type MaskResult
} from './pii-mask.js';

export {
  dedupePairs,
  type DedupeResult
} from './dedupe.js';

export {
  scoreOne,
  scoreAll,
  type QualityOptions
} from './quality.js';

export {
  createDefaultDistiller,
  noopDistiller,
  parseDistillerOutput,
  DISTILL_PROMPT_TEMPLATE,
  type DefaultDistillerOptions
} from './distiller.js';

export {
  buildManifest,
  writeCorpus,
  hashConfig,
  type WriteCorpusInputs
} from './manifest.js';

export {
  ALL_SOURCE_TAGS,
  type ChatMessage,
  type ClaudeDistiller,
  type CorpusManifest,
  type DistillInput,
  type DistillOutput,
  type DropReason,
  type DroppedRecord,
  type EventBusClient,
  type EventBusRecord,
  type FsReader,
  type GithubClient,
  type GithubPrRecord,
  type InstructionPair,
  type LangfuseClient,
  type LangfuseTraceRecord,
  type RawArtifact,
  type ReaderContext,
  type SourceReader,
  type SourceTag
} from './types.js';
