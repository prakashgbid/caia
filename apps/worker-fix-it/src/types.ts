/**
 * Fix-It Test Agent — shared types — FIX-001 (Phase 2D).
 *
 * The orchestration loop trades several structured payloads with the
 * orchestrator, the Coding Agent worker, and the dashboard. This file
 * is the single declared source of truth for those payload shapes.
 *
 * Every payload is a `z.object().strict()` so unexpected fields fail
 * loudly — the Phase 2 inter-agent contract is small and we want any
 * drift to surface immediately rather than silently propagate stale
 * data into the dashboard.
 *
 * Naming convention: `XPayload` for event-bus payloads (matching the
 * `payload:` block in `events-taxonomy-internal/registry.yaml`),
 * `XReport` / `XRequest` for richer in-process structures persisted
 * to `test_case_runs.failure_diagnosis_json`.
 *
 * @owner fix-it-test-agent (Phase 2D worker track)
 */

import { z } from 'zod';

// ─── Event payloads ─────────────────────────────────────────────────────────

/**
 * Payload of `task.coding_complete` — emitted by the Coding Agent
 * worker once `gh pr create` succeeds and local unit + integration
 * tests pass. The Fix-It Test Agent subscribes and uses this payload
 * to bootstrap a testing session against the same worktree.
 *
 * `worktreePath` and `codingSessionId` are critical for the in-session
 * fix loop: Fix-It re-uses the warm worktree directly and re-invokes
 * the same Claude SDK session through the Coding Agent's IPC channel.
 */
export const CodingCompletePayloadSchema = z
  .object({
    storyId: z.string().min(1, 'storyId is required'),
    workerId: z.string().min(1, 'workerId is required'),
    prUrl: z.string().url('prUrl must be a URL'),
    prNumber: z.number().int().nonnegative(),
    sha: z
      .string()
      .min(7, 'sha must be at least 7 chars')
      .max(64, 'sha must be at most 64 chars'),
    /** Did the Coding Agent's local unit + integration tests pass before opening the PR? */
    localTestsPassed: z.boolean(),
    /** Absolute path to the still-warm worktree the Coding Agent worked in. */
    worktreePath: z.string().min(1),
    /** UUID of the Claude SDK session the Coding Agent is holding open. */
    codingSessionId: z.string().min(1),
    /** Epoch ms when `task.coding_complete` was published. */
    completedAt: z.number().int().nonnegative(),
    /** Correlation id of the originating prompt — propagated through every event. */
    correlationId: z.string().min(1),
  })
  .strict();

export type CodingCompletePayload = z.infer<typeof CodingCompletePayloadSchema>;

/**
 * Payload of `task.testing_started` — emitted once the Fix-It Test
 * Agent has acknowledged a `task.coding_complete` and started its
 * own session.
 */
export const TestingStartedPayloadSchema = z
  .object({
    storyId: z.string().min(1),
    workerId: z.string().min(1),
    fixItSessionId: z.string().min(1),
    startedAt: z.number().int().nonnegative(),
    correlationId: z.string().min(1),
  })
  .strict();

export type TestingStartedPayload = z.infer<typeof TestingStartedPayloadSchema>;

/**
 * Payload of `task.test_case.result` — one row per (test_case, attempt).
 * Persisted by the orchestrator to `test_case_runs` and rendered live
 * on `/stories/[id]` via the dashboard timeline (FIX-011).
 */
export const TestCaseResultPayloadSchema = z
  .object({
    storyId: z.string().min(1),
    testCaseId: z.string().min(1),
    status: z.enum(['running', 'passed', 'failed', 'skipped', 'flaky']),
    attempt: z.number().int().min(1),
    durationMs: z.number().int().nonnegative().nullable(),
    traceUrl: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    correlationId: z.string().min(1),
  })
  .strict();

export type TestCaseResultPayload = z.infer<typeof TestCaseResultPayloadSchema>;

/**
 * Payload of `task.fix_requested` — emitted by Fix-It Agent when a
 * test-case attempt failed and a fix has been requested from the
 * Coding Agent's IPC.
 */
export const FixRequestedPayloadSchema = z
  .object({
    storyId: z.string().min(1),
    testCaseId: z.string().min(1),
    attempt: z.number().int().min(1),
    /** Tag pointing at the persisted `test_case_runs.failure_diagnosis_json`. */
    contextRef: z.string().min(1),
    /** Short human-readable summary of what we asked the Coding Agent to fix. */
    fixRequestSummary: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export type FixRequestedPayload = z.infer<typeof FixRequestedPayloadSchema>;

/**
 * Payload of `task.fix_applied` — emitted by the Coding Agent (via
 * the IPC `apply_fix` handler) once a fix has been committed to the
 * feature branch. Fix-It Agent re-tests the failing case after this.
 */
export const FixAppliedPayloadSchema = z
  .object({
    storyId: z.string().min(1),
    testCaseId: z.string().min(1),
    attempt: z.number().int().min(1),
    sha: z.string().min(7).max(64),
    /** Short summary of the diff the Coding Agent applied. */
    summary: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export type FixAppliedPayload = z.infer<typeof FixAppliedPayloadSchema>;

/**
 * Terminal success — every test case green. Task Manager picks this
 * up to release the worker and auto-merge the PR (per PR-lifecycle).
 */
export const TestedAndDonePayloadSchema = z
  .object({
    storyId: z.string().min(1),
    workerId: z.string().min(1),
    /** Epoch ms when the last failing case finally passed. */
    allPassedAt: z.number().int().nonnegative(),
    /** Sum of attempts across every test case. */
    totalAttempts: z.number().int().min(1),
    finalSha: z.string().min(7).max(64),
    correlationId: z.string().min(1),
  })
  .strict();

export type TestedAndDonePayload = z.infer<typeof TestedAndDonePayloadSchema>;

/**
 * Terminal failure — at least one test case exhausted the loop. The
 * Task Manager files a `fix-stuck` blocker; the dashboard surfaces it
 * on `/blockers`.
 */
export const FixLoopEscalatedPayloadSchema = z
  .object({
    storyId: z.string().min(1),
    workerId: z.string().min(1),
    exhaustedTestCaseIds: z
      .array(z.string().min(1))
      .min(1, 'at least one test case must be exhausted to escalate'),
    /** Per-case last failure summary. */
    lastFailures: z
      .array(
        z
          .object({
            testCaseId: z.string().min(1),
            attempt: z.number().int().min(1),
            errorMessage: z.string(),
          })
          .strict(),
      )
      .min(1),
    escalatedAt: z.number().int().nonnegative(),
    correlationId: z.string().min(1),
  })
  .strict();

export type FixLoopEscalatedPayload = z.infer<typeof FixLoopEscalatedPayloadSchema>;

// ─── In-process structures ──────────────────────────────────────────────────

/**
 * Structured artifacts captured by the FailureDiagnoser when a test
 * case fails. Persisted as JSON; lands fully in FIX-004.
 */
export const TestFailureReportSchema = z
  .object({
    testCaseId: z.string().min(1),
    attempt: z.number().int().min(1),
    category: z.enum([
      'happy',
      'edge',
      'error',
      'accessibility',
      'security',
      'performance',
      'visual',
    ]),
    errorMessage: z.string(),
    errorStack: z.string().nullable(),
    failingAssertion: z.string().nullable(),
    artifacts: z
      .object({
        screenshotUrl: z.string().nullable().optional(),
        tracePath: z.string().nullable().optional(),
        consoleLog: z.array(z.string()).optional(),
        networkLog: z.array(z.unknown()).optional(),
        domSnapshot: z.string().nullable().optional(),
        seedFixtures: z.unknown().optional(),
      })
      .strict(),
    /** Local-LLM (or fallback Claude) hypothesis. */
    inferredCause: z.string(),
  })
  .strict();

export type TestFailureReport = z.infer<typeof TestFailureReportSchema>;

/**
 * The structured fix request Fix-It Agent hands to the Coding Agent
 * via IPC. Land fully in FIX-005; declared here so the orchestrator
 * skeleton can plumb it.
 */
export const FixRequestSchema = z
  .object({
    storyId: z.string().min(1),
    testCaseId: z.string().min(1),
    attempt: z.number().int().min(1),
    whatFailed: z.string().min(1),
    hypothesisFromDiagnoser: z.string(),
    artifactsRef: z
      .object({
        screenshotUrl: z.string().nullable().optional(),
        tracePath: z.string().nullable().optional(),
      })
      .strict()
      .optional(),
    testCaseSpecPath: z.string().min(1),
    hintFiles: z.array(z.string().min(1)).default([]),
    /**
     * Default 'fix-only' for predictability — the Coding Agent should
     * only touch what's needed to flip the failing case green.
     */
    preserveScopeOf: z.enum(['fix-only', 'allow-refactor']).default('fix-only'),
  })
  .strict();

export type FixRequest = z.infer<typeof FixRequestSchema>;

/**
 * A single test case's terminal outcome after the retest loop. Used
 * internally by the orchestrator to compose the final
 * `task.tested_and_done` or `task.fix_loop_escalated` payload.
 */
export const TestCaseOutcomeSchema = z
  .object({
    testCaseId: z.string().min(1),
    finalStatus: z.enum(['passed', 'exhausted', 'fix-failed']),
    attempts: z.number().int().min(1),
    lastSha: z.string().min(7).max(64).optional(),
    lastErrorMessage: z.string().optional(),
  })
  .strict();

export type TestCaseOutcome = z.infer<typeof TestCaseOutcomeSchema>;

/** Final result the orchestrator returns to its caller. */
export type FixItRunResult =
  | { kind: 'tested_and_done'; payload: TestedAndDonePayload }
  | { kind: 'fix_loop_escalated'; payload: FixLoopEscalatedPayload };
