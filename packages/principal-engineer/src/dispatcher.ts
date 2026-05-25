/**
 * Dispatcher — per-wave fan-out of Full-Stack-Engineer subagents.
 *
 * Responsibilities:
 *   - For each parallel-bucket in a wave, fire one FSE spawn per ticket,
 *     up to the per-wave concurrency cap (clamped by the tenant tier).
 *   - Use @chiefaia/claude-spawner.spawnClaude (subscription-only — no
 *     ANTHROPIC_API_KEY set). Test-injectable via SpawnFn.
 *   - Compose the FSE prompt from a system-prompt template (read from
 *     fseSubagentPath at construction time) + a per-ticket user prompt.
 *   - For each ticket, drive StateMachine.transition(projectId,
 *     'scheduled', …) once the dispatch is recorded. The FSE itself
 *     transitions scheduled -> coding-in-progress when it picks up the
 *     ticket via the worker pool.
 *   - On spawn failure or transition rejection, mark the ticket as a
 *     failure and surface it in the ScheduleResult.
 *
 * The dispatcher itself is NOT a long-lived process — it fires the
 * per-wave fan-out, awaits all spawns (Promise.all), then returns. The
 * orchestrator decides how to sequence waves (it walks the WavePlan in
 * order and calls the dispatcher once per wave).
 */

import { readFile } from 'node:fs/promises';

import type {
  ProjectState,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';

import type {
  DispatchAttempt,
  SchedulerStateMachine,
  SpawnFn,
  Ticket,
  WaveBucket,
} from './types.js';

/** Default spawn timeout — 30 min, matches the brief's "coding work" budget. */
export const DEFAULT_SPAWN_TIMEOUT_MS = 30 * 60 * 1000;

/** Default agent attribution used when the caller doesn't supply one. */
export const DEFAULT_TRIGGERED_BY: TriggeredBy = Object.freeze({
  kind: 'agent',
  id: '@caia/principal-engineer',
});

/** Pipeline state we transition to on successful dispatch. */
const SCHEDULED_STATE: ProjectState = 'scheduled';
/** Pipeline state we transition to when dispatch is impossible. */
const SCHEDULING_FAILED_STATE: ProjectState = 'scheduling-failed';

export interface DispatcherOptions {
  readonly stateMachine: SchedulerStateMachine;
  readonly spawnFn: SpawnFn;
  /** Path to the FSE subagent template (eg .../claude-subagents/agents/caia-coding.md). */
  readonly fseSubagentPath: string;
  /** Workers to round-robin over. Must be non-empty when dispatching for real. */
  readonly workerIds: readonly string[];
  /** Per-spawn timeout in ms. Defaults to DEFAULT_SPAWN_TIMEOUT_MS. */
  readonly spawnTimeoutMs?: number;
  /**
   * Optional override of the system-prompt loader. Tests use this to
   * avoid touching the filesystem.
   */
  readonly loadSystemPrompt?: (path: string) => Promise<string>;
  /** Attribution for FSM transitions. */
  readonly triggeredBy?: TriggeredBy;
  /**
   * Optional override of the per-ticket user prompt template. Defaults to
   * a sensible plain-text rendering. Tests use this to assert prompt shape.
   */
  readonly renderUserPrompt?: (input: {
    ticket: Ticket;
    projectId: string;
    waveIndex: number;
    bucketId: string;
  }) => string;
  /** When true, only computes spawn args + transitions but does not actually invoke spawnFn. */
  readonly dryRun?: boolean;
}

export class Dispatcher {
  private readonly stateMachine: SchedulerStateMachine;
  private readonly spawnFn: SpawnFn;
  private readonly fseSubagentPath: string;
  private readonly workerIds: readonly string[];
  private readonly spawnTimeoutMs: number;
  private readonly loadSystemPrompt: (path: string) => Promise<string>;
  private readonly triggeredBy: TriggeredBy;
  private readonly renderUserPrompt: NonNullable<DispatcherOptions['renderUserPrompt']>;
  private readonly dryRun: boolean;

  private systemPromptCache: string | null = null;

  constructor(opts: DispatcherOptions) {
    this.stateMachine = opts.stateMachine;
    this.spawnFn = opts.spawnFn;
    this.fseSubagentPath = opts.fseSubagentPath;
    this.workerIds = opts.workerIds;
    this.spawnTimeoutMs = opts.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS;
    this.loadSystemPrompt =
      opts.loadSystemPrompt ?? ((p: string) => readFile(p, 'utf8'));
    this.triggeredBy = opts.triggeredBy ?? DEFAULT_TRIGGERED_BY;
    this.renderUserPrompt = opts.renderUserPrompt ?? renderDefaultUserPrompt;
    this.dryRun = opts.dryRun ?? false;
  }

  /**
   * Fire FSEs for every ticket in a single parallel bucket, in parallel.
   * Sequential-after buckets should be dispatched one at a time by the
   * orchestrator after the predecessor finishes.
   *
   * Returns one DispatchAttempt per ticket, in the order they appear in
   * the bucket.
   */
  async dispatchBucket(
    bucket: WaveBucket,
    ticketsById: ReadonlyMap<string, Ticket>,
    projectIdByTicket: Readonly<Record<string, string>>,
  ): Promise<DispatchAttempt[]> {
    if (this.workerIds.length === 0 && !this.dryRun) {
      throw new Error('Dispatcher.dispatchBucket: no workers registered');
    }
    const systemPrompt = this.dryRun ? "<dry-run-system-prompt>" : await this.ensureSystemPrompt();

    const attempts = bucket.ticketIds.map((ticketId, idx) => {
      const ticket = ticketsById.get(ticketId);
      const projectId = projectIdByTicket[ticketId];
      if (!ticket) {
        return Promise.resolve(
          this.failedAttempt(
            ticketId,
            projectId ?? '<unknown>',
            this.workerIds[idx % Math.max(this.workerIds.length, 1)] ?? 'dry-run-worker',
            `ticket ${ticketId} not found in ticket map`,
          ),
        );
      }
      if (!projectId) {
        return Promise.resolve(
          this.failedAttempt(
            ticketId,
            '<unknown>',
            this.workerIds[idx % Math.max(this.workerIds.length, 1)] ?? 'dry-run-worker',
            `projectIdByTicket missing entry for ticket ${ticketId}`,
          ),
        );
      }
      const workerId =
        this.workerIds.length > 0
          ? this.workerIds[idx % this.workerIds.length]!
          : 'dry-run-worker';
      return this.dispatchOne({
        ticket,
        projectId,
        workerId,
        waveIndex: bucket.waveIndex,
        bucketId: bucket.bucketId,
        systemPrompt,
      });
    });

    return Promise.all(attempts);
  }

  private async ensureSystemPrompt(): Promise<string> {
    if (this.systemPromptCache !== null) return this.systemPromptCache;
    try {
      this.systemPromptCache = await this.loadSystemPrompt(this.fseSubagentPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Dispatcher: failed to load FSE subagent template at ${this.fseSubagentPath}: ${msg}`,
      );
    }
    return this.systemPromptCache;
  }

  private failedAttempt(
    ticketId: string,
    projectId: string,
    workerId: string,
    reason: string,
  ): DispatchAttempt {
    return Object.freeze({
      ticketId,
      projectId,
      workerId,
      ok: false,
      durationMs: 0,
      stdout: '',
      stderr: '',
      diagnostic: reason,
      transition: null,
      failureReason: reason,
    });
  }

  private async dispatchOne(input: {
    ticket: Ticket;
    projectId: string;
    workerId: string;
    waveIndex: number;
    bucketId: string;
    systemPrompt: string;
  }): Promise<DispatchAttempt> {
    const { ticket, projectId, workerId, waveIndex, bucketId, systemPrompt } = input;

    const userPrompt = this.renderUserPrompt({ ticket, projectId, waveIndex, bucketId });
    const fullPrompt = composePrompt(systemPrompt, userPrompt);

    if (this.dryRun) {
      const transition = await this.recordScheduled(projectId, ticket.ticketId, workerId);
      return Object.freeze({
        ticketId: ticket.ticketId,
        projectId,
        workerId,
        ok: true,
        durationMs: 0,
        stdout: '',
        stderr: '',
        diagnostic: null,
        transition,
      });
    }

    let spawnRes;
    try {
      spawnRes = await this.spawnFn({
        prompt: fullPrompt,
        options: {
          timeoutMs: this.spawnTimeoutMs,
          extraEnv: { CAIA_FSE_WORKER_ID: workerId, CAIA_PROJECT_ID: projectId },
          accountId: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failureTransition = await this.recordSchedulingFailed(
        projectId,
        ticket.ticketId,
        `spawn-threw: ${msg}`,
      );
      return Object.freeze({
        ticketId: ticket.ticketId,
        projectId,
        workerId,
        ok: false,
        durationMs: 0,
        stdout: '',
        stderr: '',
        diagnostic: `spawn-threw: ${msg}`,
        transition: failureTransition,
        failureReason: msg,
      });
    }

    if (!spawnRes.ok) {
      const reason = spawnRes.diagnostic ?? `rc=${spawnRes.rc} timedOut=${spawnRes.timedOut}`;
      const failureTransition = await this.recordSchedulingFailed(
        projectId,
        ticket.ticketId,
        `spawn-failed: ${reason}`,
      );
      return Object.freeze({
        ticketId: ticket.ticketId,
        projectId,
        workerId,
        ok: false,
        durationMs: spawnRes.durationMs,
        stdout: truncate(spawnRes.stdout, 4096),
        stderr: truncate(spawnRes.stderr, 4096),
        diagnostic: reason,
        transition: failureTransition,
        failureReason: reason,
      });
    }

    const transition = await this.recordScheduled(projectId, ticket.ticketId, workerId);
    return Object.freeze({
      ticketId: ticket.ticketId,
      projectId,
      workerId,
      ok: true,
      durationMs: spawnRes.durationMs,
      stdout: truncate(spawnRes.stdout, 4096),
      stderr: truncate(spawnRes.stderr, 4096),
      diagnostic: null,
      transition,
    });
  }

  private async recordScheduled(
    projectId: string,
    ticketId: string,
    workerId: string,
  ): Promise<TransitionResult | null> {
    try {
      return await this.stateMachine.transition(projectId, SCHEDULED_STATE, {
        reason: `principal-engineer dispatched ${ticketId} to ${workerId}`,
        triggeredBy: this.triggeredBy,
        payload: { ticketId, workerId, dispatchedAt: new Date().toISOString() },
      });
    } catch {
      return null;
    }
  }

  private async recordSchedulingFailed(
    projectId: string,
    ticketId: string,
    reason: string,
  ): Promise<TransitionResult | null> {
    try {
      return await this.stateMachine.transition(projectId, SCHEDULING_FAILED_STATE, {
        reason: `principal-engineer could not dispatch ${ticketId}: ${reason}`,
        triggeredBy: this.triggeredBy,
        payload: { ticketId, reason, failedAt: new Date().toISOString() },
      });
    } catch {
      return null;
    }
  }
}

/** Compose the system + user prompt into a single binary payload. */
export function composePrompt(systemPrompt: string, userPrompt: string): string {
  return `<system>\n${systemPrompt.trim()}\n</system>\n\n<user>\n${userPrompt.trim()}\n</user>\n`;
}

/** Default per-ticket user prompt. */
export function renderDefaultUserPrompt(input: {
  ticket: Ticket;
  projectId: string;
  waveIndex: number;
  bucketId: string;
}): string {
  const { ticket, projectId, waveIndex, bucketId } = input;
  const deps =
    ticket.dependsOn.length === 0
      ? '(none)'
      : ticket.dependsOn.join(', ');
  const locks =
    !ticket.resourceLocks || ticket.resourceLocks.length === 0
      ? '(none)'
      : ticket.resourceLocks.join(', ');
  return [
    `# Ticket: ${ticket.ticketId}`,
    ``,
    `Project: ${projectId}`,
    `Wave: ${waveIndex}`,
    `Bucket: ${bucketId}`,
    `Depends on: ${deps}`,
    `Resource locks: ${locks}`,
    ``,
    `You are the Full-Stack Engineer assigned to this ticket. Read the BA enrichment, the EA architecture decision, and the test plan in the ticket repository; implement the change end-to-end; open a PR; report DONE.`,
  ].join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated ${s.length - max} bytes]`;
}
