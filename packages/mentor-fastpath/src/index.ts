/**
 * @chiefaia/mentor-fastpath — public API.
 *
 * Phase 1 of the Mentor agent (per `mentor_agent_directive.md`):
 * reactive fast-path. Subscribes to OperatorCorrection events from the
 * mentor-event-bus, classifies the failure mode against the 18-category
 * taxonomy, and synthesizes a durable lesson + proposes a memory update
 * within 1 minute of the operator correction.
 *
 * PR-1 delivered the consumer + classifier + offset-store skeleton.
 * PR-2 added the synthesizer + memory-writer + proposal-callback
 * factory that wires them into the consumer's onClassified hook.
 *
 * Phase 2 PR-1 (this PR) adds the postmerge data layer — pure-function
 * classifier + synthesizer for PRMerged / EvidenceGateFailure /
 * RegressionDetected / PostMergeBugReport event payloads. The producer
 * (gh-CLI poller) and consumer (long-running subscriber) wire these in
 * subsequent PRs.
 *
 * Typical Phase-1 use (long-running daemon):
 *
 *   import {
 *     runConsumer,
 *     makeProposalCallback
 *   } from '@chiefaia/mentor-fastpath';
 *
 *   await runConsumer({
 *     eventsDbPath: process.env.CAIA_EVENT_BUS_DB_PATH!,
 *     onClassified: makeProposalCallback({
 *       memoryDir: process.env.CAIA_MEMORY_DIR!
 *     })
 *   });
 *
 * Phase-2 postmerge data-layer use (PR-1 only):
 *
 *   import {
 *     classifyPostMerge,
 *     synthesizePostMerge
 *   } from '@chiefaia/mentor-fastpath/postmerge';
 *
 *   const cls = classifyPostMerge(input);
 *   const lesson = synthesizePostMerge(eventRow, input, cls);
 */

export {
  runConsumer,
  processOnce,
  processBatch,
  EVENT_TYPE,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_BATCH_SIZE,
  type ConsumerOptions
} from './consumer.js';

export { classifyCorrection, _ruleCount } from './classifier.js';

export {
  openOffsetDb,
  close as closeOffsetDb,
  getLastProcessedOffset,
  recordProcessed,
  isProcessed,
  countProcessed
} from './offset-store.js';

export {
  synthesize,
  slugify,
  type SynthesizedLesson
} from './synthesizer.js';

export {
  writeProposal,
  listProposals,
  buildFilename,
  formatTimestampPrefix,
  PROPOSALS_SUBDIR,
  type WrittenProposal,
  type WriteProposalOptions
} from './memory-writer.js';

export {
  makeProposalCallback,
  type ProposalCallbackOptions
} from './proposal-callback.js';

export type {
  ClassificationResult,
  EventRow,
  FailureMode,
  Generalizability,
  OperatorCorrectionInput,
  ProcessedRecord,
  Severity
} from './types.js';

// ─── Phase-2 postmerge data layer ─────────────────────────────────────────

export {
  classifyPostMerge,
  synthesizePostMerge,
  _postmergeJobTagCount,
  type PostMergeInput,
  type PostMergeEventRow
} from './postmerge/index.js';
