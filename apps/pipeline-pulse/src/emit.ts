/**
 * emit.ts — writes the pulse_runs DB row and emits system.pipeline_pulse event.
 * @no-events — this file IS the event emitter for the pulse system
 */

import * as path from 'path';
import * as os from 'os';
import type { PulseResult, PulseContext } from './types';

export async function persistAndEmit(result: PulseResult, ctx: PulseContext): Promise<void> {
  await persistRun(result, ctx);
  await emitEvent(result, ctx);
}

async function persistRun(result: PulseResult, ctx: PulseContext): Promise<void> {
  const dbUrl = ctx.dbUrl ?? path.join(os.homedir(), '.conductor', 'db.sqlite');
  try {
    // Use the API to persist so we don't need direct DB access from this app
    await fetch(`${ctx.apiBase}/pulse/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        id: result.runId,
        ran_at: result.ranAt,
        outcome: result.outcome,
        canary_id: result.canary.taskId,
        canary_elapsed_ms: result.canary.elapsedMs,
        checks_json: JSON.stringify(result.checks),
        invariants_json: JSON.stringify(result.invariants),
        heals_json: JSON.stringify(result.heals),
        duration_ms: result.durationMs,
      }),
    });
  } catch (err) {
    // Non-fatal — we still return results even if persist fails
    process.stderr.write(`[pulse] warn: failed to persist run: ${String(err)}\n`);
  }
  void dbUrl; // referenced to keep the import
}

async function emitEvent(result: PulseResult, ctx: PulseContext): Promise<void> {
  const checksPassed = result.checks.filter(c => c.passed).length;
  await fetch(`${ctx.apiBase}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({
      type: 'system.pipeline_pulse',
      actor: 'system',
      correlation_id: result.runId,
      entity_type: 'pulse_run',
      entity_id: result.runId,
      payload: {
        run_id: result.runId,
        outcome: result.outcome,
        duration_ms: result.durationMs,
        checks_total: result.checks.length,
        checks_passed: checksPassed,
        heals_applied: result.heals.filter(h => h.success).length,
        canary_elapsed_ms: result.canary.elapsedMs,
      },
    }),
  }).catch(() => { /* best-effort */ });
}

export async function emitCheckEvent(
  ctx: PulseContext,
  checkName: string,
  passed: boolean,
  message: string,
): Promise<void> {
  await fetch(`${ctx.apiBase}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      type: passed ? 'system.startup' : 'system.error',
      actor: 'system',
      correlation_id: ctx.runId,
      payload: { component: `pulse.check.${checkName}`, message, passed },
    }),
  }).catch(() => { /* best-effort */ });
}

export async function emitHealEvent(
  ctx: PulseContext,
  action: string,
  triggeredBy: string,
  success: boolean,
  error?: string,
): Promise<void> {
  const type = success ? 'pulse.heal_applied' : 'pulse.heal_failed';
  await fetch(`${ctx.apiBase}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      type,
      actor: 'system',
      correlation_id: ctx.runId,
      payload: { run_id: ctx.runId, action, triggered_by: triggeredBy, error },
    }),
  }).catch(() => { /* best-effort */ });
}

export async function emitCanaryEvent(
  ctx: PulseContext,
  eventType: 'pulse.canary_dispatched' | 'pulse.canary_completed',
  payload: Record<string, unknown>,
): Promise<void> {
  await fetch(`${ctx.apiBase}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({ type: eventType, actor: 'system', correlation_id: ctx.runId, payload }),
  }).catch(() => { /* best-effort */ });
}
