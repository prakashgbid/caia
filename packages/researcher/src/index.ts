/**
 * @chiefaia/researcher — public exports.
 */

export { ResearcherAgent } from './agent.js';
export {
  resolveConfig,
  CAIA_DEFAULT_REPORTS_ROOT,
  CAIA_DEFAULT_MEMORY_DIR,
  CAIA_DEFAULT_LIBRARIAN_DB_PATH,
  subQuestionsForDepth,
  sourcesPerQuestionForDepth
} from './config.js';
export type {
  ResearcherAgentConfig,
  ResolvedResearcherConfig
} from './config.js';
export { createDefaultLlmClient, parseEnvelope, extractFirstJsonBlock } from './llm-client.js';
export {
  createCommandLineSearcher,
  createFixtureSearcher
} from './fetchers/web-searcher.js';
export {
  createDefaultWebFetcher,
  createFixtureWebFetcher,
  htmlToText,
  extractTitle
} from './fetchers/web-fetcher.js';
export type { HttpFetcher } from './fetchers/web-fetcher.js';
export {
  createCommandLinePrecedentSource,
  createFixturePrecedentSource,
  createEmptyPrecedentSource
} from './fetchers/precedent-source.js';
export { classifyTrust } from './trust.js';
export {
  scrubVerbatimRuns,
  buildNgramSet,
  tokenize
} from './ngram.js';
export {
  planResearch,
  parsePlannerOutput,
  buildPlannerPrompt,
  fallbackPlan
} from './planner.js';
export type { PlannerInput, PlannerOptions } from './planner.js';
export {
  executePlan,
  canonicalizeUrl
} from './executor.js';
export type { ExecutorOptions, ExecutorOutput } from './executor.js';
export {
  runSynthesis,
  buildSynthesisPrompt,
  parseRawSynthesis,
  estimateTokens,
  assignSourceIds
} from './synthesizer.js';
export type {
  SynthesizerOptions,
  SynthesizerInput,
  SynthesizerOutput
} from './synthesizer.js';
export { verify, countCitations } from './verifier.js';
export type { VerifierOptions, VerifierInput, VerifierOutput } from './verifier.js';
export { assembleMarkdown } from './markdown.js';
export * from './types.js';
