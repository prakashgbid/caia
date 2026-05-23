/**
 * @caia/ea-dispatcher — invoker.ts
 *
 * Default `ArchitectInvoker` implementation — wraps `architect.run(input)`
 * with a wall-clock deadline. The dispatcher passes this in via DI so tests
 * can swap in a mock that returns canned outputs without spawning Claude.
 *
 * The deadline implementation uses `Promise.race` against a `setTimeout`.
 * If the timeout fires first, the invoker returns a synthetic `failed`
 * output rather than throwing — keeping the dispatcher's invariant that
 * a single architect's misbehavior never crashes the whole fan-out.
 */

import type {
  ArchitectInput,
  ArchitectOutput,
  SpecialistArchitect,
} from '@caia/architect-kit';
import type { ArchitectInvoker } from './types.js';

export class DefaultArchitectInvoker implements ArchitectInvoker {
  async invoke(
    architect: SpecialistArchitect,
    input: ArchitectInput,
    deadlineMs: number,
  ): Promise<ArchitectOutput> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ArchitectOutput>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            architectName: architect.name,
            architectureFields: {},
            confidence: 0,
            notes: '',
            dependencies: [],
            risks: [],
            toolCalls: [],
            spend: {
              inputTokens: 0,
              outputTokens: 0,
              usdCost: 0,
              wallClockMs: deadlineMs,
              model: 'timeout',
            },
            status: 'failed',
            failureReason: `architect '${architect.name}' exceeded deadline of ${deadlineMs}ms`,
          }),
        deadlineMs,
      );
    });

    try {
      const result = await Promise.race([architect.run(input), timeout]);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        architectName: architect.name,
        architectureFields: {},
        confidence: 0,
        notes: '',
        dependencies: [],
        risks: [],
        toolCalls: [],
        spend: {
          inputTokens: 0,
          outputTokens: 0,
          usdCost: 0,
          wallClockMs: 0,
          model: 'exception',
        },
        status: 'failed',
        failureReason: `architect '${architect.name}' threw: ${message}`,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// ─── In-memory telemetry + clock + state-machine for tests ─────────────────

import type {
  ArchitectCallRecord,
  Clock,
  StateMachineAdapter,
  TelemetrySink,
} from './types.js';

export class InMemoryTelemetrySink implements TelemetrySink {
  readonly rows: ArchitectCallRecord[] = [];
  async recordArchitectCall(row: ArchitectCallRecord): Promise<void> {
    this.rows.push(row);
  }
  clear(): void {
    this.rows.length = 0;
  }
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  isoNow(): string {
    return new Date().toISOString();
  }
}

export class FrozenClock implements Clock {
  constructor(private millis: number = Date.parse('2026-01-01T00:00:00Z')) {}
  now(): number {
    return this.millis;
  }
  isoNow(): string {
    return new Date(this.millis).toISOString();
  }
  advance(by: number): void {
    this.millis += by;
  }
}

/** No-op state machine — tests that don't care about transitions. */
export class NoopStateMachine implements StateMachineAdapter {
  readonly transitions: Array<{
    projectId: string;
    toState: string;
    reason: string;
  }> = [];
  readonly claims: Array<{ ticketId: string; agentId: string }> = [];
  readonly heartbeats: Array<{ ticketId: string; agentId: string }> = [];
  readonly releases: Array<{
    ticketId: string;
    agentId: string;
    finalStatus: string;
  }> = [];

  async claimTicketForAgent(ticketId: string, agentId: string): Promise<{ claimed: boolean }> {
    this.claims.push({ ticketId, agentId });
    return { claimed: true };
  }
  async heartbeat(ticketId: string, agentId: string): Promise<void> {
    this.heartbeats.push({ ticketId, agentId });
  }
  async releaseTicket(
    ticketId: string,
    agentId: string,
    finalStatus: 'done' | 'failed' | 'aborted',
  ): Promise<{ ok: boolean }> {
    this.releases.push({ ticketId, agentId, finalStatus });
    return { ok: true };
  }
  async transition(
    projectId: string,
    toState: 'ea-complete' | 'ea-dispatching-failed' | 'ea-dispatching',
    opts: { reason: string; triggeredBy: { kind: 'agent'; id: string } },
  ): Promise<{ applied: boolean }> {
    this.transitions.push({ projectId, toState, reason: opts.reason });
    return { applied: true };
  }
}
