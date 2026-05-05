/**
 * Mentor Phase-2 postmerge module — public surface.
 *
 * Phase 2 (per `mentor_agent_directive.md` ## Phased rollout) extends
 * Mentor to react to event-driven signals from the platform itself:
 *
 *   - PRMerged          — a PR landed
 *   - EvidenceGateFailure — a required CI check failed (pre-merge)
 *   - RegressionDetected — CI red on a SHA that includes a merge commit
 *   - PostMergeBugReport — operator filed a bug after merge
 *
 * The Phase-2 module ships in three logical layers:
 *
 *   PR-1 (data layer)         — classifyPostMerge() + synthesizePostMerge()
 *                                 (pure functions, no I/O)
 *   PR-2 (producer)           — caia-postmerge-watcher polls gh CLI and
 *                                 emits events into the bus
 *   PR-3 (consumer + glue)    — caia-postmerge-consumer subscribes to
 *                                 the bus and writes proposals via the
 *                                 Phase-1 memory-writer
 *
 * Typical end-to-end production flow (Phase-2 PR-3+):
 *
 *     // Producer (own LaunchAgent):
 *     caia-postmerge-watcher watch
 *
 *     // Consumer (own LaunchAgent):
 *     caia-postmerge-consumer watch --memory $CAIA_MEMORY_DIR
 *
 * They communicate via the events.sqlite owned by the existing
 * mentor-event-bus server. Both can run in parallel with the Phase-1
 * fastpath (different offset DBs).
 */

export {
  classifyPostMerge,
  _jobTagCount as _postmergeJobTagCount
} from './classifier.js';

export { synthesizePostMerge } from './synthesizer.js';

// ─── Phase-2 PR-3 — consumer ──────────────────────────────────────────────

export {
  runPostMergeConsumer,
  processPostMergeOnce,
  processPostMergeBatch,
  POSTMERGE_EVENT_TYPES,
  DEFAULT_POSTMERGE_POLL_INTERVAL_MS,
  DEFAULT_POSTMERGE_BATCH_SIZE,
  type PostMergeConsumerOptions,
  type PostMergeEventType
} from './consumer.js';

export type {
  PostMergeInput,
  PostMergeEventRow,
  ClassificationResult,
  FailureMode,
  Generalizability,
  Severity
} from './types.js';
