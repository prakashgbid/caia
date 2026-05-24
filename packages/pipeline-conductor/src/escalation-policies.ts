/**
 * @caia/pipeline-conductor — escalation-policies.ts
 * Per-stage thresholds. Sourced from spec §10.1.
 */

import { readFileSync, existsSync } from 'node:fs';
import type { StageName } from './types.js';

export interface StageThresholds {
  /** Seconds in state without transition. 0 disables. */
  dwell: number;
  /** Seconds without agent heartbeat. 0 disables. */
  heartbeat: number;
}

export type EscalationPolicyMap = Record<StageName, StageThresholds>;

/** Defaults — values in seconds. Sourced verbatim from spec §10.1. */
export const DEFAULT_STAGE_THRESHOLDS: EscalationPolicyMap = {
  'onboarding':               { dwell: 86_400,  heartbeat: 0 },
  'idea-captured':            { dwell: 86_400,  heartbeat: 0 },
  'interviewing':             { dwell: 86_400,  heartbeat: 0 },
  'interview-complete':       { dwell: 7_200,   heartbeat: 7_200 },
  'proposal-generated':       { dwell: 3_600,   heartbeat: 3_600 },
  'awaiting-external-design': { dwell: 604_800, heartbeat: 0 },
  'design-uploaded':          { dwell: 3_600,   heartbeat: 3_600 },
  'ticket-tree-generated':    { dwell: 3_600,   heartbeat: 3_600 },
  'atlas-ready':              { dwell: 3_600,   heartbeat: 3_600 },
  'ea-dispatching':           { dwell: 7_200,   heartbeat: 7_200 },
  'ea-complete':              { dwell: 3_600,   heartbeat: 3_600 },
  'tests-authored':           { dwell: 7_200,   heartbeat: 7_200 },
  'tests-reviewed':           { dwell: 3_600,   heartbeat: 3_600 },
  'scheduled':                { dwell: 1_800,   heartbeat: 1_800 },
  'coding-in-progress':       { dwell: 86_400,  heartbeat: 1_800 },
  'code-complete':            { dwell: 3_600,   heartbeat: 3_600 },
  'per-story-tested':         { dwell: 1_800,   heartbeat: 1_800 },
  'e2e-tested':               { dwell: 1_800,   heartbeat: 1_800 },
  'deploying':                { dwell: 1_800,   heartbeat: 1_800 },
  'deployed':                 { dwell: 3_600,   heartbeat: 0 },
  'verified':                 { dwell: 3_600,   heartbeat: 3_600 },
};

export const REPEATED_FAILURE_POLICY = {
  windowSeconds: 3_600,
  threshold: 3,
} as const;

export const WATCHDOG_TICK_SECONDS = 30;

export const SEVERITY_ESCALATION_MULTIPLIER = 2;

export function loadEscalationPolicies(overridePath?: string): EscalationPolicyMap {
  if (!overridePath || !existsSync(overridePath)) {
    return { ...DEFAULT_STAGE_THRESHOLDS };
  }
  const raw = JSON.parse(readFileSync(overridePath, 'utf8')) as Partial<EscalationPolicyMap>;
  const merged: EscalationPolicyMap = { ...DEFAULT_STAGE_THRESHOLDS };
  for (const [stage, thresholds] of Object.entries(raw)) {
    if (!(stage in DEFAULT_STAGE_THRESHOLDS)) {
      console.warn(`[pipeline-conductor] unknown stage '${stage}' in policy override; ignoring`);
      continue;
    }
    if (!thresholds) continue;
    merged[stage as StageName] = {
      ...DEFAULT_STAGE_THRESHOLDS[stage as StageName],
      ...thresholds,
    };
  }
  return merged;
}

export interface StuckCheckInput {
  stage: StageName;
  paused: boolean;
  secondsInState: number;
  secondsSinceHeartbeat: number | null;
  hasActiveAgent: boolean;
}

export interface StuckCheckResult {
  stuck: boolean;
  reason: 'dwell' | 'heartbeat' | null;
  thresholdSeconds: number;
  elapsedSeconds: number;
}

export function checkStuck(
  policy: EscalationPolicyMap,
  input: StuckCheckInput,
): StuckCheckResult {
  if (input.paused) {
    return { stuck: false, reason: null, thresholdSeconds: 0, elapsedSeconds: 0 };
  }
  const thresholds = policy[input.stage];
  if (!thresholds) {
    return { stuck: false, reason: null, thresholdSeconds: 0, elapsedSeconds: 0 };
  }
  if (
    input.hasActiveAgent &&
    thresholds.heartbeat > 0 &&
    input.secondsSinceHeartbeat !== null &&
    input.secondsSinceHeartbeat > thresholds.heartbeat
  ) {
    return {
      stuck: true,
      reason: 'heartbeat',
      thresholdSeconds: thresholds.heartbeat,
      elapsedSeconds: input.secondsSinceHeartbeat,
    };
  }
  if (thresholds.dwell > 0 && input.secondsInState > thresholds.dwell) {
    return {
      stuck: true,
      reason: 'dwell',
      thresholdSeconds: thresholds.dwell,
      elapsedSeconds: input.secondsInState,
    };
  }
  return { stuck: false, reason: null, thresholdSeconds: 0, elapsedSeconds: 0 };
}
