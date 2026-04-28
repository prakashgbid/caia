import { eventBus } from '../../src/events/bus-adapter';
import type { ConductorEvent } from '../../packages/event-bus/index';

describe('EventBus', () => {
  it('emits and receives conductor:event', (done) => {
    const listener = (event: ConductorEvent) => {
      expect(event.type).toBe('task.created');
      expect(event.entity_id).toBe('tsk_ws_test');
      eventBus.off('conductor:event', listener);
      done();
    };

    eventBus.on('conductor:event', listener);
    eventBus.publish({ type: 'task.created', actor: 'user', entity_id: 'tsk_ws_test', payload: { task_id: 'tsk_ws_test', title: 'test' } });
  });

  it('fans out to multiple listeners', (done) => {
    let count = 0;
    const target = 2;
    const check = () => {
      count++;
      if (count === target) {
        eventBus.off('conductor:event', l1);
        eventBus.off('conductor:event', l2);
        done();
      }
    };
    const l1 = check as (e: unknown) => void;
    const l2 = check as (e: unknown) => void;

    eventBus.on('conductor:event', l1);
    eventBus.on('conductor:event', l2);
    eventBus.publish({ type: 'system.startup', actor: 'system', payload: { component: 'test', version: '0' } });
  });

  it('unsubscribed listeners do not receive events', (done) => {
    let called = false;
    const listener = () => { called = true; };

    eventBus.on('conductor:event', listener);
    eventBus.off('conductor:event', listener);
    eventBus.publish({ type: 'domain.created', actor: 'user', payload: { domain_slug: 'x', name: 'x' } });

    setTimeout(() => {
      expect(called).toBe(false);
      done();
    }, 50);
  });

  it('includes project_slug in events', (done) => {
    const listener = (event: ConductorEvent) => {
      if (event.project_slug === 'proj_abc') {
        expect(event.project_slug).toBe('proj_abc');
        eventBus.off('conductor:event', listener);
        done();
      }
    };

    eventBus.on('conductor:event', listener);
    eventBus.publish({
      type: 'story.created', actor: 'api', project_slug: 'proj_abc',
      payload: { story_id: 's1', title: 'test', kind: 'task' },
    });
  });

  it('glob subscribe resolves correct events', (done) => {
    const received: ConductorEvent[] = [];
    const unsub = eventBus.subscribe('task.*', (e) => { received.push(e); });

    eventBus.publish({ type: 'task.created', actor: 'user', payload: {} });
    eventBus.publish({ type: 'story.created', actor: 'user', payload: {} });
    eventBus.publish({ type: 'task.completed', actor: 'executor', payload: {} });

    setTimeout(() => {
      unsub();
      expect(received.length).toBe(2);
      expect(received.every(e => e.type.startsWith('task.'))).toBe(true);
      done();
    }, 10);
  });
});
