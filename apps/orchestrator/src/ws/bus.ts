/**
 * WebSocket event bus — thin bridge to the canonical event bus.
 *
 * Existing callers use bus.push(wsEvent) for legacy WS-only events.
 * New callers use eventBus.publish() from packages/event-bus.
 *
 * The WS gateway (index.ts) listens on 'conductor:event' on the eventBus;
 * bus.push() delegates to eventBus so both paths share one emitter.
 */

import { eventBus } from '../events/bus-adapter';

export { eventBus };

export interface ConductorWsEvent {
  kind: string;
  id?: string;
  projectId?: string;
  before?: unknown;
  after?: unknown;
  payload?: unknown;
  ts: string;
}

type EventListener = (...args: unknown[]) => void;

/** Legacy push — wraps the WS-shaped payload into a conductor event */
export const bus = {
  push(data: ConductorWsEvent): void {
    eventBus.publish({
      type: 'user.action',
      actor: 'user',
      payload: { kind: data.kind, id: data.id, projectId: data.projectId, before: data.before, after: data.after, data: data.payload },
      entity_id: data.id,
    });
  },
  on(event: string, listener: EventListener): void { eventBus.on(event, listener); },
  off(event: string, listener: EventListener): void { eventBus.off(event, listener); },
  emit(event: string, ...args: unknown[]): boolean { return eventBus.emit(event, ...args); },
};
