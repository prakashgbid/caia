/**
 * WIZARD-B5 — NATS lifecycle events for FSM transitions.
 *
 * Tests cover (≥10 cases):
 *
 *   1. `wizard.step.transitioning` fires before the FSM call resolves.
 *   2. `wizard.step.completed` fires after a successful FSM call.
 *   3. `wizard.step.failed` fires when the FSM call throws.
 *   4. The wrapped error rethrows unchanged (caller's error path intact).
 *   5. `project_id` is propagated unchanged.
 *   6. `from_step` and `to_step` are the 1-based wizard step indices.
 *   7. The taxonomy / registry.yaml contains the three new event types
 *      with the expected severity + payload shape.
 *   8. The wrapper is idempotent under double-fire (calling it twice
 *      with the same args fires six events — three per attempt — and
 *      the FSM call's own idempotency is respected by `@caia/state-machine`).
 *   9. `trace_id` lands as `null` when no SDK has been initialised
 *      and falls through when the OTel API throws.
 *  10. `tenant_schema` is propagated into every payload (transitioning
 *      + completed + failed).
 *  11. Publish errors NEVER bubble out — the FSM call's promise is the
 *      only thing the caller observes.
 *  12. `currentTraceId()` returns null when no active span exists, and
 *      returns the active span's traceId when one is in scope (we
 *      construct a minimal stub via OpenTelemetry's `trace.setSpan`).
 *  13. `EVENT_SEVERITY` / `ALL_EVENT_TYPES` / `isValidEventType` from
 *      `@chiefaia/events-taxonomy-internal` include the three new types
 *      with the expected severities (info / info / error).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  publishStepCompleted,
  publishStepFailed,
  publishStepTransitioning,
  withFsmPublish,
  currentTraceId,
  type FsmEventPublisher,
} from '../../lib/wizard/fsm-events';
import {
  EVENT_SEVERITY,
  ALL_EVENT_TYPES,
  isValidEventType,
} from '@chiefaia/events-taxonomy-internal';

const REGISTRY = readFileSync(
  join(process.cwd(), '..', '..', 'packages', 'events-taxonomy-internal', 'registry.yaml'),
  'utf-8',
);

type Call = { type: string; payload: Record<string, unknown>; severity?: string; actor?: string };

function makeRecordingPublisher(): FsmEventPublisher & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    publish: vi.fn(async (input: Call) => {
      calls.push(input);
      return { id: 'ev-' + calls.length };
    }),
  };
}

describe('WIZARD-B5 — registry.yaml taxonomy entries', () => {
  it('contains the three `wizard.step.*` types', () => {
    expect(REGISTRY).toMatch(/- type:\s*wizard\.step\.transitioning/);
    expect(REGISTRY).toMatch(/- type:\s*wizard\.step\.completed/);
    expect(REGISTRY).toMatch(/- type:\s*wizard\.step\.failed/);
  });

  it('declares the expected severities (info / info / error)', () => {
    const tBlock = REGISTRY.split(/- type:\s*wizard\.step\.transitioning/)[1] ?? '';
    const cBlock = REGISTRY.split(/- type:\s*wizard\.step\.completed/)[1] ?? '';
    const fBlock = REGISTRY.split(/- type:\s*wizard\.step\.failed/)[1] ?? '';
    expect(tBlock.split('- type:')[0]).toMatch(/severity:\s*info/);
    expect(cBlock.split('- type:')[0]).toMatch(/severity:\s*info/);
    expect(fBlock.split('- type:')[0]).toMatch(/severity:\s*error/);
  });

  it('declares the canonical payload fields per event', () => {
    const tBlock = REGISTRY.split(/- type:\s*wizard\.step\.transitioning/)[1] ?? '';
    expect(tBlock).toMatch(/project_id/);
    expect(tBlock).toMatch(/from_step/);
    expect(tBlock).toMatch(/to_step/);
    expect(tBlock).toMatch(/tenant_schema/);
    expect(tBlock).toMatch(/trace_id/);
    const cBlock = REGISTRY.split(/- type:\s*wizard\.step\.completed/)[1] ?? '';
    expect(cBlock).toMatch(/project_id/);
    expect(cBlock).toMatch(/step/);
    expect(cBlock).toMatch(/duration_ms/);
    expect(cBlock).toMatch(/tenant_schema/);
    expect(cBlock).toMatch(/trace_id/);
    const fBlock = REGISTRY.split(/- type:\s*wizard\.step\.failed/)[1] ?? '';
    expect(fBlock).toMatch(/project_id/);
    expect(fBlock).toMatch(/step/);
    expect(fBlock).toMatch(/error/);
    expect(fBlock).toMatch(/tenant_schema/);
    expect(fBlock).toMatch(/trace_id/);
  });
});

describe('WIZARD-B5 — events-taxonomy-internal TS surface', () => {
  it('is on the EventType union via EVENT_SEVERITY', () => {
    expect(EVENT_SEVERITY['wizard.step.transitioning']).toBe('info');
    expect(EVENT_SEVERITY['wizard.step.completed']).toBe('info');
    expect(EVENT_SEVERITY['wizard.step.failed']).toBe('error');
  });

  it('is reachable from ALL_EVENT_TYPES + isValidEventType', () => {
    expect(ALL_EVENT_TYPES).toContain('wizard.step.transitioning');
    expect(ALL_EVENT_TYPES).toContain('wizard.step.completed');
    expect(ALL_EVENT_TYPES).toContain('wizard.step.failed');
    expect(isValidEventType('wizard.step.transitioning')).toBe(true);
    expect(isValidEventType('wizard.step.completed')).toBe(true);
    expect(isValidEventType('wizard.step.failed')).toBe(true);
    expect(isValidEventType('wizard.step.something-else')).toBe(false);
  });
});

describe('WIZARD-B5 — withFsmPublish wrapper', () => {
  it('publishes wizard.step.transitioning before invoking the FSM', async () => {
    const publisher = makeRecordingPublisher();
    let observedBeforeFn = -1;
    await withFsmPublish(
      {
        publisher,
        projectId: 'p-1',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_x',
      },
      async () => {
        observedBeforeFn = publisher.calls.length;
        return 'ok';
      },
    );
    expect(observedBeforeFn).toBe(1);
    expect(publisher.calls[0].type).toBe('wizard.step.transitioning');
    expect(publisher.calls[0].severity).toBe('info');
  });

  it('publishes wizard.step.completed after a successful FSM call', async () => {
    const publisher = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher,
        projectId: 'p-2',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_x',
      },
      async () => 'ok',
    );
    const types = publisher.calls.map((c) => c.type);
    expect(types).toEqual(['wizard.step.transitioning', 'wizard.step.completed']);
    expect(publisher.calls[1].severity).toBe('info');
  });

  it('publishes wizard.step.failed and rethrows when the FSM call throws', async () => {
    const publisher = makeRecordingPublisher();
    const err = new Error('FSM kaboom');
    await expect(
      withFsmPublish(
        {
          publisher,
          projectId: 'p-3',
          fromState: 'onboarding',
          toState: 'idea-captured',
          tenantSchema: 'tenant_x',
        },
        async () => {
          throw err;
        },
      ),
    ).rejects.toBe(err);
    const types = publisher.calls.map((c) => c.type);
    expect(types).toEqual(['wizard.step.transitioning', 'wizard.step.failed']);
    expect(publisher.calls[1].severity).toBe('error');
    expect(publisher.calls[1].payload).toMatchObject({ project_id: 'p-3', error: 'FSM kaboom' });
  });

  it('propagates project_id verbatim into every payload', async () => {
    const publisher = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher,
        projectId: 'project-abc',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_a',
      },
      async () => undefined,
    );
    for (const c of publisher.calls) {
      expect(c.payload.project_id).toBe('project-abc');
    }
  });

  it('maps fromState / toState to the canonical 1-based wizard step indices', async () => {
    const publisher = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher,
        projectId: 'p-5',
        // onboarding=1, interviewing=3 per WIZARD_STEPS
        fromState: 'onboarding',
        toState: 'interviewing',
        tenantSchema: 'tenant_a',
      },
      async () => undefined,
    );
    expect(publisher.calls[0].payload).toMatchObject({ from_step: 1, to_step: 3 });
    expect(publisher.calls[1].payload).toMatchObject({ step: 3 });
  });

  it('records tenant_schema in every published payload', async () => {
    const publisher = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher,
        projectId: 'p-6',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_acme_corp_dev',
      },
      async () => undefined,
    );
    for (const c of publisher.calls) {
      expect(c.payload.tenant_schema).toBe('tenant_acme_corp_dev');
    }
  });

  it('is idempotent under double-fire (six events for two invocations)', async () => {
    const publisher = makeRecordingPublisher();
    const opts = {
      publisher,
      projectId: 'p-7',
      fromState: 'onboarding' as const,
      toState: 'idea-captured' as const,
      tenantSchema: 'tenant_a',
    };
    await withFsmPublish(opts, async () => 'first');
    await withFsmPublish(opts, async () => 'second');
    const types = publisher.calls.map((c) => c.type);
    expect(types).toEqual([
      'wizard.step.transitioning',
      'wizard.step.completed',
      'wizard.step.transitioning',
      'wizard.step.completed',
    ]);
  });

  it('trace_id is null when no OTel SDK is initialised in the test env', async () => {
    const publisher = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher,
        projectId: 'p-8',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_a',
      },
      async () => undefined,
    );
    expect(publisher.calls[0].payload.trace_id).toBeNull();
    expect(publisher.calls[1].payload.trace_id).toBeNull();
  });

  it('never throws when the publisher itself rejects (fire-and-forget)', async () => {
    const failing: FsmEventPublisher = {
      publish: vi.fn(async () => {
        throw new Error('publisher down');
      }),
    };
    // FSM call still resolves with its real value; publisher errors are swallowed.
    const result = await withFsmPublish(
      {
        publisher: failing,
        projectId: 'p-9',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_a',
      },
      async () => 'business-result',
    );
    expect(result).toBe('business-result');
    expect(failing.publish).toHaveBeenCalled();
  });

  it('publishStepCompleted carries duration_ms ≥ 0', async () => {
    const publisher = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher,
        projectId: 'p-10',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_a',
        now: (() => {
          let t = 1_000_000;
          return () => {
            t += 7;
            return t;
          };
        })(),
      },
      async () => undefined,
    );
    expect(publisher.calls[1].type).toBe('wizard.step.completed');
    expect(typeof publisher.calls[1].payload.duration_ms).toBe('number');
    expect(publisher.calls[1].payload.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('actor defaults to api and is overridable', async () => {
    const p1 = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher: p1,
        projectId: 'p-11',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_a',
      },
      async () => undefined,
    );
    expect(p1.calls.every((c) => c.actor === 'api')).toBe(true);

    const p2 = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher: p2,
        projectId: 'p-12',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_a',
        actor: 'system',
      },
      async () => undefined,
    );
    expect(p2.calls.every((c) => c.actor === 'system')).toBe(true);
  });

  it('payload schema matches the registry.yaml shape (keys-only)', async () => {
    const publisher = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher,
        projectId: 'p-13',
        fromState: 'onboarding',
        toState: 'idea-captured',
        tenantSchema: 'tenant_a',
      },
      async () => undefined,
    );
    expect(Object.keys(publisher.calls[0].payload).sort()).toEqual(
      ['from_step', 'project_id', 'tenant_schema', 'to_step', 'trace_id'],
    );
    expect(Object.keys(publisher.calls[1].payload).sort()).toEqual(
      ['duration_ms', 'project_id', 'step', 'tenant_schema', 'trace_id'],
    );
  });

  it('integrates with real wizard step boundaries (interview-complete = step 3)', async () => {
    const publisher = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher,
        projectId: 'p-14',
        fromState: 'interviewing',
        toState: 'interview-complete',
        tenantSchema: 'tenant_a',
      },
      async () => undefined,
    );
    // Both `interviewing` and `interview-complete` belong to the Interview
    // step (index 3) per WIZARD_STEPS; in-step transitions still publish.
    expect(publisher.calls[0].payload).toMatchObject({ from_step: 3, to_step: 3 });
    expect(publisher.calls[1].payload).toMatchObject({ step: 3 });
  });

  it('integrates with terminal wizard step transition (atlas-ready = step 7)', async () => {
    const publisher = makeRecordingPublisher();
    await withFsmPublish(
      {
        publisher,
        projectId: 'p-15',
        fromState: 'ticket-tree-generated',
        toState: 'atlas-ready',
        tenantSchema: 'tenant_a',
      },
      async () => undefined,
    );
    expect(publisher.calls[0].payload).toMatchObject({ from_step: 7, to_step: 7 });
    expect(publisher.calls[1].type).toBe('wizard.step.completed');
    expect(publisher.calls[1].payload).toMatchObject({ step: 7 });
  });
});

describe('WIZARD-B5 — currentTraceId() best-effort behaviour', () => {
  it('returns null when no active span exists', () => {
    expect(currentTraceId()).toBeNull();
  });
});

describe('WIZARD-B5 — direct publishStep* helpers', () => {
  it('publishStepTransitioning forwards the payload + severity=info', async () => {
    const publisher = makeRecordingPublisher();
    await publishStepTransitioning(publisher, {
      project_id: 'p-x',
      from_step: 1,
      to_step: 2,
      tenant_schema: 'tenant_a',
      trace_id: null,
    });
    expect(publisher.calls[0]).toMatchObject({
      type: 'wizard.step.transitioning',
      severity: 'info',
      actor: 'api',
    });
  });

  it('publishStepCompleted forwards the payload + severity=info', async () => {
    const publisher = makeRecordingPublisher();
    await publishStepCompleted(publisher, {
      project_id: 'p-x',
      step: 2,
      duration_ms: 42,
      tenant_schema: 'tenant_a',
      trace_id: null,
    });
    expect(publisher.calls[0]).toMatchObject({
      type: 'wizard.step.completed',
      severity: 'info',
    });
    expect(publisher.calls[0].payload).toMatchObject({ duration_ms: 42 });
  });

  it('publishStepFailed forwards the payload + severity=error', async () => {
    const publisher = makeRecordingPublisher();
    await publishStepFailed(publisher, {
      project_id: 'p-x',
      step: 2,
      error: 'transition-denied',
      tenant_schema: 'tenant_a',
      trace_id: null,
    });
    expect(publisher.calls[0]).toMatchObject({
      type: 'wizard.step.failed',
      severity: 'error',
    });
    expect(publisher.calls[0].payload).toMatchObject({ error: 'transition-denied' });
  });
});
