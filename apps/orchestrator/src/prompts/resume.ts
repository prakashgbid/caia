/**
 * In-flight prompt resume on orchestrator boot.
 *
 * Per the 2026-05-04 Phase-2 stability audit (finding #3, deferred from
 * the overnight campaign as T-010), prompts that were mid-pipeline when
 * the orchestrator was killed by launchd / Ctrl-C / OOM are left in a
 * non-terminal status forever — `prompt.received` was emitted but no
 * subsequent `prompt.status_changed` will ever fire.
 *
 * This module sweeps non-terminal prompts at boot and decides one of
 * three outcomes per prompt:
 *
 *   • **cold-restart** — prompt has 0 descendants (decomposition never
 *     started). Emit `prompt.resumed` with reason `cold-restart` so a
 *     downstream consumer can re-pick. Status stays `received`.
 *
 *   • **stalled-but-complete** — all descendants are in terminal status
 *     (done / failed / answered) but the prompt itself never advanced.
 *     The orchestrator died after the last descendant transition but
 *     before the final `updatePromptStatus(answered)`. Move the prompt
 *     to `answered` (this also fires `pipeline.completed` via the
 *     existing manager.ts plumbing).
 *
 *   • **warm-restart** — prompt has descendants but at least one is
 *     still non-terminal. Emit `prompt.resumed` with reason
 *     `warm-restart` and the descendant counts; do not change the
 *     prompt status (the in-flight descendants still have their own
 *     recovery path via the executor / worker reconcile loops).
 *
 * Conservative by design — we never *retry* anything; we only *signal*
 * recoverability and update the one safe status (stalled-but-complete).
 * The pickup mechanism is an existing consumer's responsibility.
 *
 * Reference:
 *   - ~/Documents/projects/reports/principal-overnight-shipped-2026-05-04.md
 *     §"Pipeline edge-case hardening" finding #3
 *   - agent/memory/feedback_definition_of_done.md
 */

import { eq, lt, inArray, and } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { prompts } from '../db/schema';
import { eventBus } from '../events/bus-adapter';
import { getPromptDescendants, updatePromptStatus } from './manager';
import type { Prompt, PromptStatus } from './types';

/** PromptStatus values that mean "still in flight". */
const NON_TERMINAL_STATUSES = ['received', 'analyzing', 'decomposed'] as const;

/** Descendant statuses considered terminal (i.e. no further work expected). */
const TERMINAL_DESCENDANT_STATUSES = new Set([
  'done',
  'completed',
  'answered',
  'failed',
  'cancelled',
  'archived',
]);

export interface ResumeStalledPromptsOptions {
  /**
   * Minimum age (ms) before a non-terminal prompt is considered stalled.
   * Defaults to 60_000 (60s). Tests pass small values; production boots
   * use the default to avoid sweeping prompts that *just* arrived in the
   * last second of the previous orchestrator's life.
   */
  minStalledMs?: number;
  /** Reference now-ms. Default Date.now(). */
  nowMs?: number;
  /** Cap on the number of prompts to process per sweep. Default 1000. */
  maxSweep?: number;
}

export interface ResumeOutcome {
  promptId: string;
  outcome: 'cold-restart' | 'warm-restart' | 'stalled-but-complete';
  ageSeconds: number;
  descendantCounts?: { total: number; terminal: number; nonTerminal: number };
}

export interface ResumeStalledPromptsResult {
  swept: number;
  coldRestart: number;
  warmRestart: number;
  markedAnswered: number;
  outcomes: ResumeOutcome[];
}

/**
 * Sweep non-terminal prompts and apply the resume policy. Idempotent:
 * a second invocation with the same DB state will be a no-op for
 * `warm-restart` and `cold-restart` outcomes (no DB mutation), and for
 * `stalled-but-complete` (already moved to terminal `answered`).
 */
export function resumeStalledPrompts(
  db: Db,
  opts: ResumeStalledPromptsOptions = {},
): ResumeStalledPromptsResult {
  const minStalledMs = opts.minStalledMs ?? 60_000;
  const nowMs = opts.nowMs ?? Date.now();
  const maxSweep = opts.maxSweep ?? 1000;
  const cutoffIso = new Date(nowMs - minStalledMs).toISOString();

  const stalled = db
    .select()
    .from(prompts)
    .where(
      and(
        inArray(prompts.status, [...NON_TERMINAL_STATUSES]),
        lt(prompts.receivedAt, cutoffIso),
      ),
    )
    .limit(maxSweep)
    .all() as Prompt[];

  const result: ResumeStalledPromptsResult = {
    swept: stalled.length,
    coldRestart: 0,
    warmRestart: 0,
    markedAnswered: 0,
    outcomes: [],
  };

  for (const prompt of stalled) {
    const ageSeconds = Math.floor((nowMs - new Date(prompt.receivedAt).getTime()) / 1000);
    const descendants = getPromptDescendants(db, prompt.id);
    const total = descendants.length;
    const terminal = descendants.filter((d) => TERMINAL_DESCENDANT_STATUSES.has(d.status))
      .length;
    const nonTerminal = total - terminal;

    if (total === 0) {
      // cold-restart: nothing happened yet. Re-signal so a consumer can pick.
      eventBus.publish({
        type: 'prompt.resumed',
        actor: 'system',
        correlation_id: prompt.correlationId,
        entity_type: 'prompt',
        entity_id: prompt.id,
        payload: {
          prompt_id: prompt.id,
          reason: 'cold-restart',
          age_seconds: ageSeconds,
          status_at_sweep: prompt.status,
          received_via: prompt.receivedVia,
        },
      });
      result.coldRestart += 1;
      result.outcomes.push({
        promptId: prompt.id,
        outcome: 'cold-restart',
        ageSeconds,
      });
      continue;
    }

    if (nonTerminal === 0) {
      // stalled-but-complete: descendants finished but prompt was never advanced.
      // Use updatePromptStatus so the existing pipeline.completed machinery fires.
      updatePromptStatus(db, prompt.id, 'answered' as PromptStatus);
      eventBus.publish({
        type: 'prompt.resumed',
        actor: 'system',
        correlation_id: prompt.correlationId,
        entity_type: 'prompt',
        entity_id: prompt.id,
        payload: {
          prompt_id: prompt.id,
          reason: 'stalled-but-complete',
          age_seconds: ageSeconds,
          descendants_total: total,
        },
      });
      result.markedAnswered += 1;
      result.outcomes.push({
        promptId: prompt.id,
        outcome: 'stalled-but-complete',
        ageSeconds,
        descendantCounts: { total, terminal, nonTerminal },
      });
      continue;
    }

    // warm-restart: in-flight descendants exist; signal but don't mutate.
    eventBus.publish({
      type: 'prompt.resumed',
      actor: 'system',
      correlation_id: prompt.correlationId,
      entity_type: 'prompt',
      entity_id: prompt.id,
      payload: {
        prompt_id: prompt.id,
        reason: 'warm-restart',
        age_seconds: ageSeconds,
        descendants_total: total,
        descendants_terminal: terminal,
        descendants_non_terminal: nonTerminal,
      },
    });
    result.warmRestart += 1;
    result.outcomes.push({
      promptId: prompt.id,
      outcome: 'warm-restart',
      ageSeconds,
      descendantCounts: { total, terminal, nonTerminal },
    });
  }

  return result;
}
