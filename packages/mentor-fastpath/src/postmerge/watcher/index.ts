/**
 * Postmerge watcher — public surface.
 *
 * The watcher polls GitHub via `gh` CLI and emits events into the
 * mentor-event-bus. Phase-2 PR-2 ships this module; Phase-2 PR-3 will
 * add the consumer that subscribes to these events and produces
 * proposals via the Phase-2 PR-1 data layer.
 */

export {
  defaultRunGh,
  listMergedPrs,
  listFailedRuns,
  getFailedJobNames,
  type RunGh,
  type GhClientOptions,
  type MergedPr,
  type FailedRun
} from './gh-client.js';

export {
  openStateStore,
  getCursor,
  setCursor,
  isPrSeen,
  recordPrSeen,
  isRunSeen,
  recordRunSeen,
  countSeenPrs,
  countSeenRuns,
  type CursorState
} from './state-store.js';

export {
  runProducer,
  runIteration,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_INITIAL_LOOKBACK_HOURS,
  DEFAULT_BASE_REFS,
  type ProducerOptions,
  type IterationStats
} from './producer.js';
