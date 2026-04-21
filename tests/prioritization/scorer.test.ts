import { scoreTask } from '../../src/prioritization/scorer';
import type { TaskScoringContext } from '../../src/prioritization/types';

function makeCtx(overrides: Partial<TaskScoringContext> = {}): TaskScoringContext {
  return {
    id: 'task_001',
    title: 'Some task',
    domainSlug: null,
    declaredFiles: [],
    notes: null,
    dependsOn: [],
    dependentCount: 0,
    openBlockerCount: 0,
    currentScore: null,
    currentBucket: null,
    currentOrdinal: null,
    ...overrides,
  };
}

describe('scoreTask', () => {
  it('returns a score between 0 and 100', () => {
    const r = scoreTask(makeCtx());
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('gives security domain a higher score than uncategorized', () => {
    const security = scoreTask(makeCtx({ domainSlug: 'security' }));
    const none = scoreTask(makeCtx({ domainSlug: null }));
    expect(security.score).toBeGreaterThan(none.score);
  });

  it('blast radius pushes score up when dependentCount >= 5', () => {
    const low = scoreTask(makeCtx({ dependentCount: 0 }));
    const high = scoreTask(makeCtx({ dependentCount: 5 }));
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('tasks with urgency keywords score higher', () => {
    const normal = scoreTask(makeCtx({ title: 'Add new feature' }));
    const urgent = scoreTask(makeCtx({ title: 'Fix critical production crash' }));
    expect(urgent.score).toBeGreaterThan(normal.score);
  });

  it('more declared files lowers score via effort inverse', () => {
    const small = scoreTask(makeCtx({ declaredFiles: ['a.ts'] }));
    const large = scoreTask(makeCtx({ declaredFiles: Array.from({ length: 10 }, (_, i) => `file${i}.ts`) }));
    expect(large.score).toBeLessThan(small.score);
  });

  it('accessibility domain scores at 1.0 criticality', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'accessibility' }));
    expect(r.dimensions.domainCriticality).toBe(1.0);
  });

  it('data-backend domain has high risk if delayed', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'data-backend' }));
    expect(r.dimensions.riskIfDelayed).toBe(1.0);
  });

  it('hardBlockerOverride true when dependentCount >= 5', () => {
    const r = scoreTask(makeCtx({ dependentCount: 5 }));
    expect(r.hardBlockerOverride).toBe(true);
  });

  it('hardBlockerOverride false when dependentCount < 5', () => {
    const r = scoreTask(makeCtx({ dependentCount: 4 }));
    expect(r.hardBlockerOverride).toBe(false);
  });

  it('includes a non-empty summary string', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'security', dependentCount: 3 }));
    expect(typeof r.summary).toBe('string');
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it('security domain with high dependents scores very high (P0 range)', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'security', dependentCount: 5 }));
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.bucket).toBe('P0');
  });

  it('all dimensions are in [0, 1] range', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'data-backend', dependentCount: 3 }));
    for (const [, val] of Object.entries(r.dimensions)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});
