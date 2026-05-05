/**
 * Glue between the consumer's `onClassified` hook and the
 * synthesizer + memory-writer chain.
 *
 * Intended call site (in `caia-mentor-fastpath watch` CLI or the
 * LaunchAgent entrypoint):
 *
 *   import { runConsumer, makeProposalCallback } from '@chiefaia/mentor-fastpath';
 *
 *   await runConsumer({
 *     eventsDbPath: process.env.CAIA_EVENT_BUS_DB_PATH!,
 *     onClassified: makeProposalCallback({
 *       memoryDir: process.env.CAIA_MEMORY_DIR!,
 *       logger: pino()
 *     })
 *   });
 *
 * The returned callback returns the absolute proposal-file path as the
 * `artifact_ref` so the offset-store records exactly which proposal each
 * event produced — useful for Stage-6 verification + later audit.
 *
 * Errors during synthesis or write are caught + logged; the callback
 * returns `undefined` rather than throwing so a failed proposal doesn't
 * block the consumer (which already has its own try/catch around
 * onClassified, but defence in depth).
 */

import type {
  ClassificationResult,
  EventRow,
  OperatorCorrectionInput
} from './types.js';
import { synthesize } from './synthesizer.js';
import { writeProposal } from './memory-writer.js';

export interface ProposalCallbackOptions {
  /**
   * Path to the agent memory directory. Proposals land in
   * `<memoryDir>/proposals/`.
   */
  memoryDir: string;
  /** Logger. Default: console. */
  logger?: { info: (m: string) => void; warn: (m: string) => void };
  /**
   * Optional clock injection — tests pass a fixed Date so the filename
   * timestamp is deterministic.
   */
  now?: () => Date;
}

const consoleLogger = {
  info: (m: string): void => console.log(m),
  warn: (m: string): void => console.warn(m)
};

/**
 * Build a `ConsumerOptions['onClassified']` callback that synthesizes a
 * proposal markdown and writes it under `<memoryDir>/proposals/`.
 *
 * Returns the proposal file's absolute path (used by the consumer as the
 * processed_events.artifact_ref) on success; returns undefined on
 * failure (write error etc — already logged).
 */
export function makeProposalCallback(
  opts: ProposalCallbackOptions
): (
  event: EventRow,
  payload: OperatorCorrectionInput,
  classification: ClassificationResult
) => string | undefined {
  const logger = opts.logger ?? consoleLogger;
  const clock = opts.now ?? ((): Date => new Date());

  return (event, payload, classification): string | undefined => {
    try {
      const lesson = synthesize(event, payload, classification);
      const written = writeProposal(lesson, {
        memoryDir: opts.memoryDir,
        now: clock()
      });
      logger.info(
        `[mentor-fastpath] proposal ${written.created ? 'written' : 'already-exists'}: ${written.path} (event=${event.id} primary=${classification.primary})`
      );
      return written.path;
    } catch (e) {
      logger.warn(
        `[mentor-fastpath] proposal write failed for event ${event.id}: ${String(e)}`
      );
      return undefined;
    }
  };
}
