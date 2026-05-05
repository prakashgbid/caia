/**
 * @chiefaia/mentor-fastpath — public API.
 *
 * Phase 1 of the Mentor agent (per `mentor_agent_directive.md`):
 * reactive fast-path. Subscribes to OperatorCorrection events from the
 * mentor-event-bus, classifies the failure mode against the 18-category
 * taxonomy, and (in subsequent PRs) synthesizes a durable lesson +
 * proposes a memory update within 1 minute of the operator correction.
 *
 * This skeleton PR delivers the consumer + classifier + offset-store. A
 * follow-up PR adds the synthesizer + memory-writer + LaunchAgent plist.
 *
 * Typical use:
 *
 *   import { runConsumer } from '@chiefaia/mentor-fastpath';
 *
 *   await runConsumer({
 *     eventsDbPath: '~/Library/Application Support/caia/events/events.sqlite'
 *   });
 *
 * One-shot:
 *
 *   import { processOnce } from '@chiefaia/mentor-fastpath';
 *
 *   const n = await processOnce({ eventsDbPath: '...' });
 *   console.log(`processed ${n} new events`);
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

export type {
  ClassificationResult,
  EventRow,
  FailureMode,
  Generalizability,
  OperatorCorrectionInput,
  ProcessedRecord,
  Severity
} from './types.js';
