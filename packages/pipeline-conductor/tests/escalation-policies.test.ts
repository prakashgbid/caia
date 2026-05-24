import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';

import {
  DEFAULT_STAGE_THRESHOLDS,
  REPEATED_FAILURE_POLICY,
  WATCHDOG_TICK_SECONDS,
  checkStuck,
  loadEscalationPolicies,
} from '../src/escalation-policies.js';

describe('DEFAULT_STAGE_THRESHOLDS', () => {
  it('has thresholds for 21 stages', () => {
    expect(Object.keys(DEFAULT_STAGE_THRESHOLDS).length).toBe(21);
  });

  it('customer-pace stages get 24h dwell', () => {
    expect(DEFAULT_STAGE_THRESHOLDS.onboarding.dwell).toBe(86_400);
    expect(DEFAULT_STAGE_THRESHOLDS.interviewing.dwell).toBe(86_400);
  });

  it('external-design gets 7-day dwell', () => {
    expect(DEFAULT_STAGE_THRESHOLDS['awaiting-external-design'].dwell).toBe(604_800);
  });

  it('coding-in-progress has 30-min heartbeat + 24h dwell', () => {
    expect(DEFAULT_STAGE_THRESHOLDS['coding-in-progress'].heartbeat).toBe(1_800);
    expect(DEFAULT_STAGE_THRESHOLDS['coding-in-progress'].dwell).toBe(86_400);
  });

  it('automated short stages have 30-min thresholds', () => {
    expect(DEFAULT_STAGE_THRESHOLDS.scheduled.dwell).toBe(1_800);
    expect(DEFAULT_STAGE_THRESHOLDS.deploying.dwell).toBe(1_800);
  });
});

describe('REPEATED_FAILURE_POLICY', () => {
  it('uses 3 failures in 1h', () => {
    expect(REPEATED_FAILURE_POLICY.threshold).toBe(3);
    expect(REPEATED_FAILURE_POLICY.windowSeconds).toBe(3_600);
  });
});

describe('WATCHDOG_TICK_SECONDS', () => {
  it('default tick is 30s', () => {
    expect(WATCHDOG_TICK_SECONDS).toBe(30);
  });
});

describe('checkStuck', () => {
  const policy = DEFAULT_STAGE_THRESHOLDS;

  it('not stuck for paused', () => {
    const r = checkStuck(policy, {
      stage: 'coding-in-progress', paused: true,
      secondsInState: 999_999, secondsSinceHeartbeat: 999_999, hasActiveAgent: true,
    });
    expect(r.stuck).toBe(false);
  });

  it('flags heartbeat-stuck', () => {
    const r = checkStuck(policy, {
      stage: 'coding-in-progress', paused: false,
      secondsInState: 60, secondsSinceHeartbeat: 1_900, hasActiveAgent: true,
    });
    expect(r.stuck).toBe(true);
    expect(r.reason).toBe('heartbeat');
  });

  it('no heartbeat-stuck when no active agent', () => {
    const r = checkStuck(policy, {
      stage: 'coding-in-progress', paused: false,
      secondsInState: 60, secondsSinceHeartbeat: 1_900, hasActiveAgent: false,
    });
    expect(r.stuck).toBe(false);
  });

  it('flags dwell-stuck for IA past 2h', () => {
    const r = checkStuck(policy, {
      stage: 'interview-complete', paused: false,
      secondsInState: 7_201, secondsSinceHeartbeat: null, hasActiveAgent: false,
    });
    expect(r.stuck).toBe(true);
    expect(r.reason).toBe('dwell');
  });

  it('not stuck at exactly threshold', () => {
    const r = checkStuck(policy, {
      stage: 'interview-complete', paused: false,
      secondsInState: 7_200, secondsSinceHeartbeat: null, hasActiveAgent: false,
    });
    expect(r.stuck).toBe(false);
  });

  it('returns not-stuck for unknown stage', () => {
    const r = checkStuck(policy, {
      // @ts-expect-error
      stage: 'unknown', paused: false,
      secondsInState: 999_999, secondsSinceHeartbeat: 999_999, hasActiveAgent: true,
    });
    expect(r.stuck).toBe(false);
  });

  it('heartbeat priority over dwell', () => {
    const r = checkStuck(policy, {
      stage: 'coding-in-progress', paused: false,
      secondsInState: 100_000, secondsSinceHeartbeat: 5_000, hasActiveAgent: true,
    });
    expect(r.reason).toBe('heartbeat');
  });

  it('zero heartbeat disables watchdog', () => {
    const r = checkStuck(policy, {
      stage: 'onboarding', paused: false,
      secondsInState: 100, secondsSinceHeartbeat: 100, hasActiveAgent: true,
    });
    expect(r.stuck).toBe(false);
  });
});

describe('loadEscalationPolicies', () => {
  it('returns defaults when undefined', () => {
    expect(loadEscalationPolicies()).toEqual(DEFAULT_STAGE_THRESHOLDS);
  });

  it('returns defaults when path missing', () => {
    expect(loadEscalationPolicies('/nope/x.json')).toEqual(DEFAULT_STAGE_THRESHOLDS);
  });

  it('merges override values', () => {
    const path = join(tmpdir(), `cp-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ 'coding-in-progress': { dwell: 999, heartbeat: 60 } }));
    try {
      const p = loadEscalationPolicies(path);
      expect(p['coding-in-progress'].dwell).toBe(999);
      expect(p.onboarding.dwell).toBe(86_400);
    } finally {
      unlinkSync(path);
    }
  });

  it('ignores unknown stages', () => {
    const path = join(tmpdir(), `cp-bad-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ 'no-such': { dwell: 1, heartbeat: 1 } }));
    try {
      const p = loadEscalationPolicies(path);
      expect(p).not.toHaveProperty('no-such');
    } finally {
      unlinkSync(path);
    }
  });
});
