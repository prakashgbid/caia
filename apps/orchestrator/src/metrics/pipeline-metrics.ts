/**
 * Pipeline observability metrics wiring (G8).
 *
 * Subscribes to the in-process event bus and drives Prometheus counters /
 * histograms that were previously defined but never populated.
 *
 * Call wirePipelineMetrics() once at server startup, after wireEventBus().
 * Returns an unsubscribe function for clean shutdown.
 *
 * Metrics wired here:
 *   conductor_stage_duration_ms{stage, status}       — existing histogram
 *   conductor_pipeline_stages_total{stage}            — new counter
 *   conductor_agent_runs_total{agent, outcome}        — new counter
 *   conductor_stories_total{outcome}                  — new counter
 *   conductor_worker_crashes_total                    — new counter
 *   conductor_capsule_freezes_total{status, reason}   — new counter
 */

import { eventBus } from '../events/bus-adapter';
import {
  stageDurationMs,
  pipelineStagesTotal,
  agentRunsTotal,
  storiesTotal,
  workerCrashesTotal,
  capsuleFreezesTotal,
} from './prometheus';

export function wirePipelineMetrics(): () => void {
  const unsubs: Array<() => void> = [];

  // pipeline.stage.advanced — fired by advancePipelineStage() for every stage
  // transition. Payload carries durationFromStartMs (ms spent in previous stage).
  unsubs.push(eventBus.subscribe('pipeline.stage.advanced', (ev) => {
    const payload = ev.payload as { stage?: string; durationFromStartMs?: number };
    const stage = payload.stage ?? 'unknown';
    pipelineStagesTotal.inc({ stage });
    if (typeof payload.durationFromStartMs === 'number' && payload.durationFromStartMs >= 0) {
      stageDurationMs.observe({ stage, status: 'success' }, payload.durationFromStartMs);
    }
  }));

  // ─── Agent completion events ─────────────────────────────────────────────

  unsubs.push(eventBus.subscribe('po-agent.decomposition.complete', () => {
    agentRunsTotal.inc({ agent: 'po-agent', outcome: 'success' });
  }));

  unsubs.push(eventBus.subscribe('ba-agent.enrichment.complete', () => {
    agentRunsTotal.inc({ agent: 'ba-agent', outcome: 'success' });
  }));

  unsubs.push(eventBus.subscribe('ea-agent.classification.complete', () => {
    agentRunsTotal.inc({ agent: 'ea-agent', outcome: 'success' });
  }));

  unsubs.push(eventBus.subscribe('ea-agent.akg.complete', () => {
    agentRunsTotal.inc({ agent: 'ea-agent-akg', outcome: 'success' });
  }));

  unsubs.push(eventBus.subscribe('test.cases_generated', () => {
    agentRunsTotal.inc({ agent: 'test-design-agent', outcome: 'success' });
  }));

  // Story validator — pass and fail are both agent completions with different outcomes
  unsubs.push(eventBus.subscribe('story.validation_passed', () => {
    agentRunsTotal.inc({ agent: 'story-validator', outcome: 'passed' });
    storiesTotal.inc({ outcome: 'validation_passed' });
  }));

  unsubs.push(eventBus.subscribe('story.validation_failed', () => {
    agentRunsTotal.inc({ agent: 'story-validator', outcome: 'failed' });
    storiesTotal.inc({ outcome: 'validation_failed' });
  }));

  // story.completed — final positive outcome for a story
  unsubs.push(eventBus.subscribe('story.completed', () => {
    storiesTotal.inc({ outcome: 'completed' });
  }));

  // ─── Worker crashes ──────────────────────────────────────────────────────

  unsubs.push(eventBus.subscribe('worker.crashed', () => {
    workerCrashesTotal.inc();
  }));

  // pipeline.failed — top-level pipeline failure
  unsubs.push(eventBus.subscribe('pipeline.failed', () => {
    storiesTotal.inc({ outcome: 'pipeline_failed' });
  }));

  // ─── Capsule freeze outcomes ─────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsubs.push(eventBus.subscribe('ticket.capsule-frozen' as never, (ev: any) => {
    const payload = (ev?.payload ?? {}) as { status?: string; reason?: string };
    const status = payload.status ?? 'unknown';
    const reason = status === 'skipped' ? (payload.reason ?? 'unknown') : '';
    capsuleFreezesTotal.inc({ status, reason });
  }));

  return () => unsubs.forEach(u => u());
}
