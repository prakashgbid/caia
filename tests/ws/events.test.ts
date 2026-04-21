import { bus } from '../../src/ws/bus';

describe('EventBus', () => {
  it('emits and receives conductor:event', (done) => {
    const payload = { kind: 'test.event', ts: new Date().toISOString(), id: 'test_1' };

    const listener = (event: typeof payload) => {
      expect(event.kind).toBe('test.event');
      expect(event.id).toBe('test_1');
      bus.off('conductor:event', listener);
      done();
    };

    bus.on('conductor:event', listener);
    bus.push(payload);
  });

  it('fans out to multiple listeners', (done) => {
    let count = 0;
    const target = 2;

    const check = () => {
      count++;
      if (count === target) {
        bus.off('conductor:event', l1);
        bus.off('conductor:event', l2);
        done();
      }
    };

    const l1 = check;
    const l2 = check;

    bus.on('conductor:event', l1);
    bus.on('conductor:event', l2);
    bus.push({ kind: 'fanout.test', ts: new Date().toISOString() });
  });

  it('unsubscribed listeners do not receive events', (done) => {
    let called = false;
    const listener = () => { called = true; };

    bus.on('conductor:event', listener);
    bus.off('conductor:event', listener);

    bus.push({ kind: 'unsub.test', ts: new Date().toISOString() });

    // Give async time to fire if it were going to
    setTimeout(() => {
      expect(called).toBe(false);
      done();
    }, 50);
  });

  it('includes projectId in events', (done) => {
    const event = {
      kind: 'project.created',
      id: 'proj_123',
      projectId: 'proj_abc',
      ts: new Date().toISOString(),
    };

    const listener = (received: typeof event) => {
      expect(received.projectId).toBe('proj_abc');
      bus.off('conductor:event', listener);
      done();
    };

    bus.on('conductor:event', listener);
    bus.push(event);
  });
});
