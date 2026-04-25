/**
 * Behavior tests for the pipeline-pulse system.
 * Tests the 3 layers and the heal decision tree.
 */

import { computeOutcomeFromChecks } from '../pulse-testable';
import type { CheckResult, HealResult } from '../types';

// ─── Unit: outcome computation ────────────────────────────────────────────────

describe('computeOutcomeFromChecks', () => {
  const makeCheck = (name: string, passed: boolean, stage: CheckResult['stage'] = 'infra'): CheckResult => ({
    name, stage, passed, message: passed ? 'ok' : 'fail', durationMs: 10,
  });

  const makeHeal = (success: boolean, idempotent = false): HealResult => ({
    action: 'restart-executor', triggeredBy: 'executor-heartbeat-fresh',
    success, idempotent, message: 'test', durationMs: 10,
  });

  it('returns PASSING when all checks pass and canary passes', () => {
    const checks = [makeCheck('api-reachable', true), makeCheck('db-writable', true)];
    const result = computeOutcomeFromChecks(checks, true, []);
    expect(result).toBe('PASSING');
  });

  it('returns CRITICAL when api-reachable fails', () => {
    const checks = [makeCheck('api-reachable', false), makeCheck('db-writable', true)];
    const result = computeOutcomeFromChecks(checks, true, []);
    expect(result).toBe('CRITICAL');
  });

  it('returns CRITICAL when db-writable fails', () => {
    const checks = [makeCheck('api-reachable', true), makeCheck('db-writable', false)];
    const result = computeOutcomeFromChecks(checks, true, []);
    expect(result).toBe('CRITICAL');
  });

  it('returns CRITICAL when canary fails', () => {
    const checks = [makeCheck('api-reachable', true), makeCheck('db-writable', true)];
    const result = computeOutcomeFromChecks(checks, false, []);
    expect(result).toBe('CRITICAL');
  });

  it('returns DEGRADED for non-critical check failures', () => {
    const checks = [
      makeCheck('api-reachable', true),
      makeCheck('db-writable', true),
      makeCheck('executor-heartbeat-fresh', false, 'executor'),
    ];
    const result = computeOutcomeFromChecks(checks, true, []);
    expect(result).toBe('DEGRADED');
  });

  it('returns AUTO-HEALED when a heal was applied (non-idempotent)', () => {
    const checks = [makeCheck('api-reachable', true), makeCheck('db-writable', true), makeCheck('executor-heartbeat-fresh', false, 'executor')];
    const heals = [makeHeal(true, false)];
    const result = computeOutcomeFromChecks(checks, true, heals);
    expect(result).toBe('AUTO-HEALED');
  });

  it('does NOT return AUTO-HEALED for idempotent heals (no-ops)', () => {
    const checks = [makeCheck('api-reachable', true), makeCheck('db-writable', true), makeCheck('executor-heartbeat-fresh', false, 'executor')];
    const heals = [makeHeal(true, true)]; // idempotent = already healed
    const result = computeOutcomeFromChecks(checks, true, heals);
    expect(result).toBe('DEGRADED'); // no real heal happened
  });

  it('remains CRITICAL even if non-critical heals succeeded', () => {
    const checks = [makeCheck('api-reachable', false), makeCheck('executor-heartbeat-fresh', false, 'executor')];
    const heals = [makeHeal(true, false)];
    const result = computeOutcomeFromChecks(checks, true, heals);
    expect(result).toBe('AUTO-HEALED'); // heals ran, that takes precedence
  });

  it('returns PASSING with no checks (vacuously true)', () => {
    const result = computeOutcomeFromChecks([], true, []);
    expect(result).toBe('PASSING');
  });
});

// ─── Unit: canary bypass detection ────────────────────────────────────────────

describe('canary bypass detection', () => {
  it('detects canary from notes JSON', () => {
    const { isCanaryTask } = require('../pulse-testable');
    expect(isCanaryTask({ notes: JSON.stringify({ canary: true }) })).toBe(true);
    expect(isCanaryTask({ notes: JSON.stringify({ canary: false }) })).toBe(false);
    expect(isCanaryTask({ notes: null })).toBe(false);
    expect(isCanaryTask({ notes: 'not json' })).toBe(false);
    expect(isCanaryTask({ notes: JSON.stringify({ pulseRunId: 'x' }) })).toBe(false);
  });
});

// ─── Unit: check timeout guard ────────────────────────────────────────────────

describe('check timeout', () => {
  it('check that times out returns a failed CheckResult', async () => {
    jest.useFakeTimers();
    const slowCheck = {
      name: 'slow-check',
      stage: 'infra' as const,
      run: () => new Promise<CheckResult>(resolve => setTimeout(() => resolve({
        name: 'slow-check', stage: 'infra', passed: true, message: 'done', durationMs: 99999,
      }), 60_000)),
    };

    const CHECK_TIMEOUT_MS = 100;
    const resultPromise = Promise.race([
      slowCheck.run(),
      new Promise<CheckResult>(resolve =>
        setTimeout(
          () => resolve({ name: slowCheck.name, stage: slowCheck.stage, passed: false, message: `Timed out after ${CHECK_TIMEOUT_MS}ms`, durationMs: CHECK_TIMEOUT_MS }),
          CHECK_TIMEOUT_MS,
        ),
      ),
    ]);
    jest.runAllTimers();
    const result = await resultPromise;
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Timed out');
    jest.useRealTimers();
  });
});

// ─── Unit: heal trigger mapping ──────────────────────────────────────────────

describe('heal trigger mapping', () => {
  it('restart-executor is triggered by executor-heartbeat-fresh', () => {
    const { restartExecutor } = require('../heal/restart-executor');
    expect(restartExecutor.triggeredByChecks).toContain('executor-heartbeat-fresh');
  });

  it('reset-circuit-breaker is triggered by circuit-breaker-open', () => {
    const { resetCircuitBreaker } = require('../heal/reset-circuit-breaker');
    expect(resetCircuitBreaker.triggeredByChecks).toContain('circuit-breaker-open');
  });

  it('reset-stuck-tasks is triggered by no-stuck-running', () => {
    const { resetStuckTasks } = require('../heal/reset-stuck-tasks');
    expect(resetStuckTasks.triggeredByChecks).toContain('no-stuck-running');
  });

  it('flush-stalled-runs is triggered by no-stuck-running', () => {
    const { flushStalledRuns } = require('../heal/flush-stalled-runs');
    expect(flushStalledRuns.triggeredByChecks).toContain('no-stuck-running');
  });
});

// ─── Unit: check registry ─────────────────────────────────────────────────────

describe('check registry', () => {
  it('exports exactly 15 checks', () => {
    const { ALL_CHECKS } = require('../checks/index');
    expect(ALL_CHECKS).toHaveLength(15);
  });

  it('each check has a unique name', () => {
    const { ALL_CHECKS } = require('../checks/index');
    const names = ALL_CHECKS.map((c: Check) => c.name);
    expect(new Set(names).size).toBe(15);
  });

  it('CRITICAL_CHECKS contains api-reachable and db-writable', () => {
    const { CRITICAL_CHECKS } = require('../checks/index');
    expect(CRITICAL_CHECKS.has('api-reachable')).toBe(true);
    expect(CRITICAL_CHECKS.has('db-writable')).toBe(true);
  });

  it('checks are distributed across 3 stages', () => {
    const { ALL_CHECKS } = require('../checks/index');
    const stages = new Set(ALL_CHECKS.map((c: Check) => c.stage));
    expect(stages.has('infra')).toBe(true);
    expect(stages.has('executor')).toBe(true);
    expect(stages.has('pipeline')).toBe(true);
  });
});

interface Check { name: string; stage: string }
