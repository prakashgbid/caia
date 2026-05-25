import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '@chiefaia/events';
import {
  POLICY_CHECK_COMPLETED,
  POLICY_VIOLATION_DETECTED,
  PolicyEngine
} from '../src/policy-engine.js';
import type { Policy } from '../src/types.js';
import { makeCtx } from './fixtures.js';

function policy(id: string, ok: boolean, mode: 'hard-fail' | 'soft-fail' | 'advisory' = 'hard-fail'): Policy {
  return {
    id,
    description: `test policy ${id}`,
    defaultMode: mode,
    async check() {
      return ok
        ? { ok: true }
        : { ok: false, mode, reason: `${id} fired`, suggestedFix: 'fix it' };
    }
  };
}

describe('PolicyEngine', () => {
  it('runs every registered policy in parallel and returns a report', async () => {
    const engine = new PolicyEngine([
      policy('a', true),
      policy('b', true),
      policy('c', true)
    ]);
    const report = await engine.run(makeCtx());
    expect(report.results).toHaveLength(3);
    expect(report.worstOutcome).toBe('pass');
    expect(report.violationCount).toBe(0);
  });

  it('aggregates worst outcome correctly when one policy hard-fails', async () => {
    const engine = new PolicyEngine([
      policy('a', true),
      policy('b', false, 'hard-fail'),
      policy('c', false, 'soft-fail')
    ]);
    const report = await engine.run(makeCtx());
    expect(report.worstOutcome).toBe('hard-fail');
    expect(report.violationCount).toBe(2);
  });

  it('treats a throwing policy as a hard-fail rather than crashing', async () => {
    const thrower: Policy = {
      id: 'throws',
      description: 'broken',
      defaultMode: 'advisory',
      async check() {
        throw new Error('boom');
      }
    };
    const engine = new PolicyEngine([thrower, policy('a', true)]);
    const report = await engine.run(makeCtx());
    expect(report.worstOutcome).toBe('hard-fail');
    const broken = report.results.find((r) => r.policyId === 'throws')!;
    expect(broken.verdict.ok).toBe(false);
    if (!broken.verdict.ok) {
      expect(broken.verdict.reason).toMatch(/Policy threw: boom/);
    }
  });

  it('refuses to construct with zero policies', () => {
    expect(() => new PolicyEngine([])).toThrow(/at least one policy/);
  });

  it('refuses duplicate policy ids', () => {
    expect(() => new PolicyEngine([policy('a', true), policy('a', true)])).toThrow(
      /Duplicate policy id/
    );
  });

  it('emits policy.check.completed for every policy', async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.on<{ policyId: string }>(POLICY_CHECK_COMPLETED, (e) => {
      seen.push(e.policyId);
    });
    const engine = new PolicyEngine([
      policy('a', true),
      policy('b', false)
    ]);
    await engine.run(makeCtx(), { eventBus: bus });
    // Events are fire-and-forget; allow microtask drain.
    await new Promise((r) => setImmediate(r));
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('emits policy.violation.detected only for non-ok verdicts', async () => {
    const bus = createEventBus();
    const violations: string[] = [];
    bus.on<{ policyId: string }>(POLICY_VIOLATION_DETECTED, (e) => {
      violations.push(e.policyId);
    });
    const engine = new PolicyEngine([
      policy('a', true),
      policy('b', false)
    ]);
    await engine.run(makeCtx(), { eventBus: bus });
    await new Promise((r) => setImmediate(r));
    expect(violations).toEqual(['b']);
  });

  it('lists registered policy ids in order', () => {
    const engine = new PolicyEngine([policy('a', true), policy('b', true)]);
    expect(engine.listPolicyIds()).toEqual(['a', 'b']);
  });

  it('respects an injected now() for the report timestamp', async () => {
    const fixed = new Date('2026-05-25T00:00:00Z');
    const engine = new PolicyEngine([policy('a', true)]);
    const report = await engine.run(makeCtx(), { now: () => fixed });
    expect(report.generatedAt).toBe('2026-05-25T00:00:00.000Z');
  });

  it('records a non-negative durationMs per result', async () => {
    const engine = new PolicyEngine([policy('a', true)]);
    const report = await engine.run(makeCtx());
    expect(report.results[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('uses Promise.allSettled semantics — one slow policy does not block others', async () => {
    const slow: Policy = {
      id: 'slow',
      description: 'slow',
      defaultMode: 'advisory',
      async check() {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true };
      }
    };
    const engine = new PolicyEngine([slow, policy('fast', true)]);
    const start = Date.now();
    await engine.run(makeCtx());
    expect(Date.now() - start).toBeLessThan(200);
  });

  // Ensure mocked event bus is not called when not provided.
  it('does not throw if no event bus is provided on violation', async () => {
    const engine = new PolicyEngine([policy('a', false)]);
    const report = await engine.run(makeCtx());
    expect(report.worstOutcome).toBe('hard-fail');
  });

  // Sanity check on vi spy compatibility
  it('event handlers receive structured payloads', async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on(POLICY_VIOLATION_DETECTED, handler);
    const engine = new PolicyEngine([policy('a', false)]);
    await engine.run(makeCtx(), { eventBus: bus });
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledTimes(1);
    const payload = handler.mock.calls[0]?.[0] as { policyId: string };
    expect(payload.policyId).toBe('a');
  });
});
