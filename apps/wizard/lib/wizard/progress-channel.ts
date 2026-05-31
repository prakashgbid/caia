/**
 * Per-project progress channel for wizard retry events (Phase B, task B7).
 *
 * Why a channel and not SSE
 *
 *   The wizard already has a `/api/wizard/[projectId]/state` GET that the
 *   UI polls (SWR `revalidateOnFocus` + manual refresh after mutations).
 *   For B7 we don't want to introduce a new transport — that would mean
 *   wiring SSE, picking a heartbeat strategy, handling Vercel/Cloudflare
 *   edge differences, and so on. Instead we ship a **simple in-memory
 *   ring buffer** keyed by `{tenantId, projectId}` and expose it via a
 *   new `GET /api/wizard/[projectId]/progress` polled by the UI.
 *
 *   The shape is sized for the wizard's actual cardinality: at most a
 *   few concurrent projects per pod, at most 32 events per project (a
 *   couple of full retry chains). Old events are evicted in FIFO order.
 *
 *   When the wizard horizontally scales beyond one pod, the natural
 *   migration is to back the channel with `@chiefaia/event-bus-nats`
 *   (same envelope shape). The publish/consume API stays the same — we
 *   purposely shaped `getProgressChannel().publish/read` to mirror the
 *   bus surface so the swap is a constructor replacement.
 *
 * Determinism for tests
 *
 *   The singleton store is reset-safe via `__resetProgressChannelForTests`
 *   so route tests can assert exact event sequences without inter-test
 *   leakage.
 */

import type { RetryErrorClass } from '@chiefaia/claude-spawner';

export interface ProgressKey {
  tenantId: string;
  projectId: string;
}

export interface ProgressEvent {
  step: 'interview.answer' | 'interview.complete' | 'proposal.generate';
  kind: 'attempt' | 'retry' | 'final';
  attempt: number;
  totalAttempts: number;
  nextDelayMs: number;
  errorClass?: RetryErrorClass;
  lastError?: string;
  occurredAtIso: string;
}

export interface ProgressChannel {
  publish(key: ProgressKey, event: ProgressEvent): void;
  read(key: ProgressKey, opts?: { sinceIso?: string }): ProgressEvent[];
  clear(key: ProgressKey): void;
}

const MAX_EVENTS_PER_PROJECT = 32;

function keyToString(k: ProgressKey): string {
  return `${k.tenantId}::${k.projectId}`;
}

class InMemoryProgressChannel implements ProgressChannel {
  private readonly store = new Map<string, ProgressEvent[]>();

  publish(key: ProgressKey, event: ProgressEvent): void {
    const k = keyToString(key);
    const events = this.store.get(k) ?? [];
    events.push(event);
    if (events.length > MAX_EVENTS_PER_PROJECT) {
      events.splice(0, events.length - MAX_EVENTS_PER_PROJECT);
    }
    this.store.set(k, events);
  }

  read(key: ProgressKey, opts: { sinceIso?: string } = {}): ProgressEvent[] {
    const events = this.store.get(keyToString(key)) ?? [];
    if (!opts.sinceIso) return [...events];
    return events.filter((e) => e.occurredAtIso > opts.sinceIso!);
  }

  clear(key: ProgressKey): void {
    this.store.delete(keyToString(key));
  }
}

let SINGLETON: ProgressChannel | null = null;

/** Module-level singleton. Routes call this; tests can reset via the test helper. */
export function getProgressChannel(): ProgressChannel {
  if (SINGLETON === null) SINGLETON = new InMemoryProgressChannel();
  return SINGLETON;
}

/** Test-only — reset between cases so emit-order assertions are deterministic. */
export function __resetProgressChannelForTests(): void {
  SINGLETON = new InMemoryProgressChannel();
}
