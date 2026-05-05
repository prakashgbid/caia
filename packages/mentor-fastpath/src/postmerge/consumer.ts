/**
 * Postmerge consumer — Phase-2 PR-3.
 *
 * Subscribes to the three postmerge event types in the mentor-event-bus
 * (PRMerged, RegressionDetected, EvidenceGateFailure), translates each
 * payload into a `PostMergeInput`, runs the Phase-2 PR-1 classifier +
 * synthesizer, and writes a proposal to `<memoryDir>/proposals/`.
 *
 * Mirrors the Phase-1 OperatorCorrection consumer's polling pattern
 * (read by ingest_offset, persist last-seen offset, idempotent across
 * restarts). Differences:
 *
 *   - Subscribes to MULTIPLE event types per iteration (not just one).
 *   - Each event type has a different payload → different
 *     PostMergeInput projection.
 *   - PRMerged-only events are skipped (Unclassified — informational).
 *
 * The proposal-writing path reuses the Phase-1 `writeProposal` helper.
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';

import { writeProposal } from '../memory-writer.js';
import {
  countProcessed,
  getLastProcessedOffset,
  isProcessed,
  openOffsetDb,
  recordProcessed
} from '../offset-store.js';
import type { ProcessedRecord } from '../types.js';

import { classifyPostMerge } from './classifier.js';
import { synthesizePostMerge } from './synthesizer.js';
import type {
  ClassificationResult,
  PostMergeEventRow,
  PostMergeInput
} from './types.js';

/** The 3 event types this consumer reacts to. */
export const POSTMERGE_EVENT_TYPES = [
  'PRMerged',
  'RegressionDetected',
  'EvidenceGateFailure'
] as const;

export type PostMergeEventType = (typeof POSTMERGE_EVENT_TYPES)[number];

/** Default poll interval — postmerge isn't latency-critical, 30s is fine. */
export const DEFAULT_POSTMERGE_POLL_INTERVAL_MS = 30_000;

export const DEFAULT_POSTMERGE_BATCH_SIZE = 100;

export interface PostMergeConsumerOptions {
  /** Path to the mentor-event-bus events.sqlite. Read-only. */
  eventsDbPath: string;
  /**
   * Path to the postmerge consumer's offset-store sqlite. Created if
   * missing. Defaults to `${eventsDbPath}.postmerge-consumer-offset.sqlite`
   * — distinct from the Phase-1 fastpath's own offset DB so the two
   * subscribers can coexist.
   */
  offsetDbPath?: string;
  /** Memory directory — proposals written under `<memoryDir>/proposals/`. */
  memoryDir: string;
  /** Poll interval in ms. Default 30s. */
  pollIntervalMs?: number;
  /** Batch size per poll. Default 100. */
  batchSize?: number;
  /** AbortSignal for graceful shutdown. */
  abortSignal?: AbortSignal;
  /** Logger. Default console. */
  logger?: { info: (m: string) => void; warn: (m: string) => void };
  /** Override sleep fn (tests). */
  sleepFn?: (ms: number) => Promise<void>;
  /** Override clock (tests). */
  now?: () => Date;
  /**
   * Override the proposal-writer (tests). Default uses memory-writer's
   * writeProposal under memoryDir.
   */
  writeProposalFn?: (
    lesson: ReturnType<typeof synthesizePostMerge>,
    when: Date
  ) => string;
}

/** Minimal payload contracts mirroring mentor-event-bus types. */
interface PRMergedPayload {
  prNumber: number;
  sha: string;
  branch: string;
  repo?: string;
  author?: string;
  title?: string;
}
interface RegressionDetectedPayload {
  testName: string;
  failedSha: string;
  passingSha?: string;
}
interface EvidenceGateFailurePayload {
  prNumber: number;
  failedJobs: string[];
}

const consoleLogger = {
  info: (m: string): void => console.log(m),
  warn: (m: string): void => console.warn(m)
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Project an event-bus row into the data-layer's PostMergeInput. Returns
 * undefined when the event isn't actionable (e.g. PRMerged with a
 * payload we can't parse — log + skip).
 */
function projectToInput(row: PostMergeEventRow): PostMergeInput | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return undefined;
  }
  const p = payload as Record<string, unknown>;

  switch (row.event_type) {
    case 'PRMerged': {
      const m = payload as PRMergedPayload;
      if (typeof m.prNumber !== 'number') return undefined;
      const out: PostMergeInput = {
        prNumber: m.prNumber,
        sha: m.sha ?? '',
        branch: m.branch ?? 'develop',
        failedJobs: [],
        signal: 'pr-merged-only'
      };
      if (m.author !== undefined) out.author = m.author;
      if (m.title !== undefined) out.title = m.title;
      return out;
    }
    case 'RegressionDetected': {
      const m = payload as RegressionDetectedPayload;
      if (typeof m.failedSha !== 'string') return undefined;
      return {
        // No PR number in this payload — convention 0 = "not associated"
        prNumber: 0,
        sha: m.failedSha,
        branch: 'develop',
        title: m.testName,
        failedJobs: typeof m.testName === 'string' ? [m.testName] : [],
        signal: 'regression-after-merge'
      };
    }
    case 'EvidenceGateFailure': {
      const m = payload as EvidenceGateFailurePayload;
      if (typeof m.prNumber !== 'number') return undefined;
      return {
        prNumber: m.prNumber,
        sha: '',
        branch: 'develop',
        failedJobs: Array.isArray(m.failedJobs) ? m.failedJobs : [],
        signal: 'evidence-gate-failed'
      };
    }
    default:
      void p; // unused; defensive
      return undefined;
  }
}

/** One iteration of the poll loop. Returns count of newly-processed events. */
export function processPostMergeBatch(
  eventsDb: DatabaseInstance,
  offsetDb: DatabaseInstance,
  batchSize: number,
  memoryDir: string,
  logger: { info: (m: string) => void; warn: (m: string) => void },
  now: () => Date,
  writeProposalFn?: (
    lesson: ReturnType<typeof synthesizePostMerge>,
    when: Date
  ) => string
): { processed: number; written: number; skipped: number } {
  const lastOffset = getLastProcessedOffset(offsetDb);
  // SQLite IN-list with three placeholders.
  const rows = eventsDb
    .prepare(
      `SELECT id, event_type, schema_version, correlation_id, parent_event_id,
              emitted_at, hostname, process_name, payload_json,
              validation_failed, ingest_offset
         FROM events
        WHERE event_type IN ('PRMerged','RegressionDetected','EvidenceGateFailure')
          AND ingest_offset > @lastOffset
        ORDER BY ingest_offset ASC
        LIMIT @batchSize`
    )
    .all({ lastOffset, batchSize }) as PostMergeEventRow[];

  let processed = 0;
  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    if (isProcessed(offsetDb, row.id)) {
      processed++;
      continue;
    }

    const input = projectToInput(row);
    let artifactRef: string | null = null;
    let classification: ClassificationResult | null = null;

    if (input === undefined) {
      logger.warn(
        `[postmerge-consumer] cannot project event ${row.id} (type=${row.event_type}) — skipping`
      );
      skipped++;
    } else {
      classification = classifyPostMerge(input);
      if (classification.primary === 'Unclassified') {
        // pr-merged-only-no-failure path → not worth a proposal.
        skipped++;
      } else {
        const lesson = synthesizePostMerge(row, input, classification);
        try {
          const path = writeProposalFn
            ? writeProposalFn(lesson, now())
            : writeProposal(lesson, { memoryDir, now: now() }).path;
          artifactRef = path;
          written++;
          logger.info(
            `[postmerge-consumer] proposal written: ${path} (event=${row.id} type=${row.event_type} primary=${classification.primary})`
          );
        } catch (e) {
          logger.warn(
            `[postmerge-consumer] proposal write failed for event ${row.id}: ${String(e)}`
          );
        }
      }
    }

    const rec: ProcessedRecord = {
      event_id: row.id,
      ingest_offset: row.ingest_offset,
      processed_at: now().toISOString(),
      classification_json: JSON.stringify(classification ?? { skipped: true }),
      artifact_ref: artifactRef
    };
    recordProcessed(offsetDb, rec);
    processed++;
  }

  return { processed, written, skipped };
}

/**
 * Run the long-running poll loop. Resolves when `abortSignal` fires.
 *
 * Each iteration is wrapped in try/catch so a transient DB or write
 * failure doesn't kill the daemon.
 */
export async function runPostMergeConsumer(
  opts: PostMergeConsumerOptions
): Promise<void> {
  const eventsDb = new Database(opts.eventsDbPath, { readonly: true });
  const offsetDbPath =
    opts.offsetDbPath ??
    `${opts.eventsDbPath}.postmerge-consumer-offset.sqlite`;
  const offsetDb = openOffsetDb(offsetDbPath);
  const pollIntervalMs =
    opts.pollIntervalMs ?? DEFAULT_POSTMERGE_POLL_INTERVAL_MS;
  const batchSize = opts.batchSize ?? DEFAULT_POSTMERGE_BATCH_SIZE;
  const logger = opts.logger ?? consoleLogger;
  const sleep = opts.sleepFn ?? defaultSleep;
  const now = opts.now ?? ((): Date => new Date());

  logger.info(
    `[postmerge-consumer] starting; eventsDb=${opts.eventsDbPath} offsetDb=${offsetDbPath} memoryDir=${opts.memoryDir} pollIntervalMs=${pollIntervalMs}`
  );
  logger.info(
    `[postmerge-consumer] resuming at offset ${getLastProcessedOffset(offsetDb)} (${countProcessed(offsetDb)} events processed previously)`
  );

  try {
    while (!(opts.abortSignal?.aborted ?? false)) {
      try {
        const stats = processPostMergeBatch(
          eventsDb,
          offsetDb,
          batchSize,
          opts.memoryDir,
          logger,
          now,
          opts.writeProposalFn
        );
        if (stats.processed > 0) {
          logger.info(
            `[postmerge-consumer] tick: processed=${stats.processed} written=${stats.written} skipped=${stats.skipped}`
          );
        }
      } catch (e) {
        logger.warn(`[postmerge-consumer] iteration threw: ${String(e)}`);
      }
      await sleep(pollIntervalMs);
    }
  } finally {
    eventsDb.close();
    offsetDb.close();
    logger.info('[postmerge-consumer] consumer stopped');
  }
}

/** One-shot run (CLI / tests). */
export async function processPostMergeOnce(
  opts: Omit<PostMergeConsumerOptions, 'pollIntervalMs' | 'abortSignal'>
): Promise<{ processed: number; written: number; skipped: number }> {
  const eventsDb = new Database(opts.eventsDbPath, { readonly: true });
  const offsetDbPath =
    opts.offsetDbPath ??
    `${opts.eventsDbPath}.postmerge-consumer-offset.sqlite`;
  const offsetDb = openOffsetDb(offsetDbPath);
  const batchSize = opts.batchSize ?? DEFAULT_POSTMERGE_BATCH_SIZE;
  const logger = opts.logger ?? consoleLogger;
  const now = opts.now ?? ((): Date => new Date());
  try {
    return processPostMergeBatch(
      eventsDb,
      offsetDb,
      batchSize,
      opts.memoryDir,
      logger,
      now,
      opts.writeProposalFn
    );
  } finally {
    eventsDb.close();
    offsetDb.close();
  }
}
