/**
 * Public surface of the orchestrator-middleware package.
 *
 * Re-exports all types, errors, utilities, and classes. Also provides the
 * `createOrchestrationGuard` factory for obtaining a single object that
 * enforces TRACE-001, TASK-001, and AUTON-001/002/006/007/008 together.
 *
 * @no-events — re-export module and factory; no domain events emitted.
 */

export type {
  BannedPhraseMatch,
  BannedPhraseResult,
  TaskSpawnRecord,
  PromptRecord,
  MiddlewareViolation,
} from './types.js';

export {
  BannedPhraseError,
  MissingRootPromptError,
  TaskRunNotRecordedError,
} from './errors.js';

export {
  BANNED_PHRASE_PATTERNS,
  scanForBannedPhrases,
  assertNoBannedPhrases,
} from './banned-phrases.js';

export { TaskRunLogger } from './task-run-logger.js';
export { PromptContext } from './prompt-creator.js';

import { PromptContext } from './prompt-creator.js';
import { TaskRunLogger } from './task-run-logger.js';
import { scanForBannedPhrases, assertNoBannedPhrases } from './banned-phrases.js';
import type { BannedPhraseResult, MiddlewareViolation } from './types.js';

/**
 * Combined guard that aggregates all three enforcement components.
 * Obtain one via `createOrchestrationGuard()`.
 */
export interface OrchestrationGuard {
  /** TRACE-001/002: prompt creation ordering enforcer. */
  promptContext: PromptContext;
  /** TASK-001: task_run_record acknowledgement tracker. */
  taskRunLogger: TaskRunLogger;
  /**
   * Scans an outbound message for AUTON banned phrases.
   * @no-events
   */
  scanMessage: (message: string) => BannedPhraseResult;
  /**
   * Asserts the outbound message is free of AUTON banned phrases.
   * Throws `BannedPhraseError` on violation.
   * @no-events
   */
  assertMessageClean: (message: string) => void;
  /**
   * Returns all violations from all sub-components, merged and sorted by
   * timestamp ascending.
   * @no-events
   */
  getAllViolations: () => MiddlewareViolation[];
  /**
   * Resets all sub-component state. Intended for use between test cases.
   * @no-events
   */
  reset: () => void;
}

/**
 * Factory that wires together all three enforcement components.
 *
 * @no-events — factory only; components emit no domain events.
 * @param ttlMs - Optional TTL override for the task-run logger (default 30 000 ms).
 * @returns A fully-initialised `OrchestrationGuard`.
 */
export function createOrchestrationGuard(ttlMs?: number): OrchestrationGuard {
  const promptContext = new PromptContext();
  const taskRunLogger = new TaskRunLogger(ttlMs);

  return {
    promptContext,
    taskRunLogger,
    scanMessage: (message: string) => scanForBannedPhrases(message),
    assertMessageClean: (message: string) => assertNoBannedPhrases(message),
    getAllViolations(): MiddlewareViolation[] {
      taskRunLogger.checkTtlViolations();
      const all = [
        ...promptContext.getViolations(),
        ...taskRunLogger.getViolations(),
      ];
      return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    },
    reset(): void {
      promptContext.reset();
      taskRunLogger.reset();
    },
  };
}
