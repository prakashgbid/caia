/**
 * Test-kit self-tests — verifies expectEventEmitted + expectLogEmitted work.
 * This is the "dogfood first" requirement: the test-kit tests itself.
 */

import { createTestBus, expectEventEmitted, expectLogEmitted } from './index';
import type { PinoLogLine } from './index';

describe('test-kit / createTestBus', () => {
  it('publish adds event to emitted array', () => {
    const { publish, emitted } = createTestBus();
    publish({ type: 'task.created', payload: { task_id: 'tsk_1', title: 'x' } });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('task.created');
    expect(emitted[0].payload).toMatchObject({ task_id: 'tsk_1' });
  });

  it('publish emits on conductor:event channel', (done) => {
    const { publish, bus } = createTestBus();
    bus.once('conductor:event', (e) => {
      expect((e as { type: string }).type).toBe('story.created');
      done();
    });
    publish({ type: 'story.created', payload: { story_id: 's1' } });
  });
});

describe('test-kit / expectEventEmitted', () => {
  it('resolves when matching event is published', async () => {
    const { publish, bus } = createTestBus();

    const promise = expectEventEmitted(bus, 'task.completed', { entity_id: 'tsk_abc' });
    publish({ type: 'task.completed', entity_id: 'tsk_abc', payload: {} });

    const event = await promise;
    expect(event.type).toBe('task.completed');
    expect(event.entity_id).toBe('tsk_abc');
  });

  it('ignores events that do not match the matcher', async () => {
    const { publish, bus } = createTestBus();

    const promise = expectEventEmitted(bus, 'task.completed', { entity_id: 'tsk_abc' }, 200);

    // Publish wrong entity_id first
    publish({ type: 'task.completed', entity_id: 'tsk_xyz', payload: {} });
    // Then correct one
    publish({ type: 'task.completed', entity_id: 'tsk_abc', payload: {} });

    const event = await promise;
    expect(event.entity_id).toBe('tsk_abc');
  });

  it('rejects if no matching event within timeout', async () => {
    const { bus } = createTestBus();
    await expect(expectEventEmitted(bus, 'task.failed', {}, 50)).rejects.toThrow(
      'expectEventEmitted: no "task.failed" event within 50ms',
    );
  });

  it('matches payload fields', async () => {
    const { publish, bus } = createTestBus();

    const promise = expectEventEmitted(bus, 'task.started', { payload: { task_id: 'tsk_match' } });
    publish({ type: 'task.started', payload: { task_id: 'tsk_nomatch', worker_pid: 1 } });
    publish({ type: 'task.started', payload: { task_id: 'tsk_match', worker_pid: 2 } });

    const event = await promise;
    expect(event.payload['task_id']).toBe('tsk_match');
  });
});

describe('test-kit / expectLogEmitted', () => {
  it('finds a matching log line', () => {
    const lines: PinoLogLine[] = [
      { level: 'info', msg: 'task started', module: 'executor', correlation_id: 'corr-1' },
      { level: 'error', msg: 'connection failed', module: 'db' },
    ];

    const found = expectLogEmitted(lines, 'info', { module: 'executor' });
    expect(found.msg).toBe('task started');
  });

  it('finds by msgContains', () => {
    const lines: PinoLogLine[] = [
      { level: 'info', msg: 'event bus wired to db' },
      { level: 'info', msg: 'server started on port 7776' },
    ];
    const found = expectLogEmitted(lines, 'info', { msgContains: 'port 7776' });
    expect(found.msg).toContain('7776');
  });

  it('throws when no matching line found', () => {
    const lines: PinoLogLine[] = [{ level: 'info', msg: 'hello' }];
    expect(() => expectLogEmitted(lines, 'error', {})).toThrow('expectLogEmitted');
  });
});
