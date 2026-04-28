import { schedule } from './scheduler';
import type { SchedulerTask, SchedulerInput } from './scheduler';

const baseConfig = {
  maxConcurrent: 3,
  maxPerDomainConcurrent: 1,
  circuitBreakerThreshold: 3,
};

function makeTask(id: string, overrides: Partial<SchedulerTask> = {}): SchedulerTask {
  return {
    id,
    status: 'queued',
    domainSlug: null,
    dependsOn: [],
    paused: false,
    attemptCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    priority: 3,
    ...overrides,
  };
}

describe('scheduler', () => {
  it('picks ready tasks up to maxConcurrent', () => {
    const input: SchedulerInput = {
      queue: [makeTask('t1'), makeTask('t2'), makeTask('t3'), makeTask('t4')],
      running: [],
      doneIds: new Set(),
      config: baseConfig,
    };
    const result = schedule(input);
    expect(result.toStart).toHaveLength(3);
    expect(result.toStart).toEqual(['t1', 't2', 't3']);
  });

  it('respects current running count', () => {
    const input: SchedulerInput = {
      queue: [makeTask('t1'), makeTask('t2')],
      running: [{ taskId: 'existing', domainSlug: null }, { taskId: 'existing2', domainSlug: null }],
      doneIds: new Set(),
      config: baseConfig,
    };
    const result = schedule(input);
    expect(result.toStart).toHaveLength(1);
  });

  it('skips tasks with unmet dependencies', () => {
    const input: SchedulerInput = {
      queue: [makeTask('t1', { dependsOn: ['t-missing'] }), makeTask('t2')],
      running: [],
      doneIds: new Set(),
      config: baseConfig,
    };
    const result = schedule(input);
    expect(result.toStart).toEqual(['t2']);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 't1', reason: expect.stringContaining('t-missing') }),
    ]));
  });

  it('allows tasks whose deps are done', () => {
    const input: SchedulerInput = {
      queue: [makeTask('t1', { dependsOn: ['t-done'] })],
      running: [],
      doneIds: new Set(['t-done']),
      config: baseConfig,
    };
    const result = schedule(input);
    expect(result.toStart).toEqual(['t1']);
  });

  it('skips paused tasks', () => {
    const input: SchedulerInput = {
      queue: [makeTask('t1', { paused: true }), makeTask('t2')],
      running: [],
      doneIds: new Set(),
      config: baseConfig,
    };
    const result = schedule(input);
    expect(result.toStart).toEqual(['t2']);
    expect(result.skipped.find(s => s.id === 't1')?.reason).toContain('circuit breaker');
  });

  it('enforces domain cap', () => {
    const input: SchedulerInput = {
      queue: [makeTask('t1', { domainSlug: 'poker' }), makeTask('t2', { domainSlug: 'poker' })],
      running: [],
      doneIds: new Set(),
      config: { ...baseConfig, maxPerDomainConcurrent: 1 },
    };
    const result = schedule(input);
    expect(result.toStart).toEqual(['t1']);
    expect(result.skipped.find(s => s.id === 't2')?.reason).toContain('domain cap');
  });

  it('allows different domains concurrently', () => {
    const input: SchedulerInput = {
      queue: [
        makeTask('t1', { domainSlug: 'poker' }),
        makeTask('t2', { domainSlug: 'roulette' }),
      ],
      running: [],
      doneIds: new Set(),
      config: { ...baseConfig, maxConcurrent: 3, maxPerDomainConcurrent: 1 },
    };
    const result = schedule(input);
    expect(result.toStart).toHaveLength(2);
  });

  it('sorts by priority then FIFO', () => {
    const input: SchedulerInput = {
      queue: [
        makeTask('t-low', { priority: 5, createdAt: '2024-01-01T00:00:00Z' }),
        makeTask('t-high', { priority: 1, createdAt: '2024-01-01T00:00:01Z' }),
        makeTask('t-mid', { priority: 3, createdAt: '2024-01-01T00:00:00Z' }),
      ],
      running: [],
      doneIds: new Set(),
      config: { ...baseConfig, maxConcurrent: 2 },
    };
    const result = schedule(input);
    expect(result.toStart).toEqual(['t-high', 't-mid']);
  });

  it('returns empty when maxConcurrent already hit', () => {
    const input: SchedulerInput = {
      queue: [makeTask('t1'), makeTask('t2')],
      running: [
        { taskId: 'a', domainSlug: null },
        { taskId: 'b', domainSlug: null },
        { taskId: 'c', domainSlug: null },
      ],
      doneIds: new Set(),
      config: baseConfig,
    };
    const result = schedule(input);
    expect(result.toStart).toHaveLength(0);
  });

  it('does not start a task already in running', () => {
    const input: SchedulerInput = {
      queue: [makeTask('t1'), makeTask('t2')],
      running: [{ taskId: 't1', domainSlug: null }],
      doneIds: new Set(),
      config: baseConfig,
    };
    const result = schedule(input);
    expect(result.toStart).not.toContain('t1');
    expect(result.toStart).toContain('t2');
  });
});
