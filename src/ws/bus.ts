import { EventEmitter } from 'events';

export interface ConductorWsEvent {
  kind: string;
  id?: string;
  projectId?: string;
  before?: unknown;
  after?: unknown;
  payload?: unknown;
  ts: string;
}

class EventBus extends EventEmitter {
  push(data: ConductorWsEvent): void {
    this.emit('conductor:event', data);
  }
}

export const bus = new EventBus();
