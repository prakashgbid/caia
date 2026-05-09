/**
 * @chiefaia/surface — public surface.
 *
 * Surface Agent — operator-curation lens. Reads PR activity, agent-memory
 * deltas, and agent transcripts; scores findings by importance; emits a
 * markdown digest under a hard size cap.
 *
 * See DESIGN.md and ../../agent-memory/surface_agent_directive.md.
 */

export { SurfaceAgent, parseSince, type GenerateDigestRequest } from './agent.js';

export {
  resolveConfig,
  expandHome,
  type SurfaceAgentConfig,
  type ResolvedSurfaceAgentConfig
} from './config.js';

export { defaultFsReader } from './fs-reader.js';
export { defaultGhRunner, defaultGitRunner } from './gh-runner.js';

export {
  createPrConnector,
  createMemoryConnector,
  createTranscriptConnector,
  parseGitLog,
  type PrConnectorOptions,
  type MemoryConnectorOptions,
  type TranscriptConnectorOptions
} from './connectors/index.js';

export {
  defaultScorer,
  applyScores
} from './scorer.js';

export {
  applyFilter,
  type FilterOptions,
  type FilterResult
} from './filter.js';

export {
  generateDigest,
  DigestSizeExceededError,
  type GenerateDigestArgs
} from './digest.js';

export type {
  CollectArgs,
  Connector,
  ConnectorResult,
  Digest,
  Finding,
  FindingKind,
  FindingSource,
  FsReader,
  GhRunner,
  GitRunner,
  ImportanceScorer,
  ScoringContext,
  FilterRule
} from './types.js';
