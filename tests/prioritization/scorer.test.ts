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

  it('HIGH_DOMAINS (integrity-check) returns 0.8 criticality', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'integrity-check' }));
    expect(r.dimensions.domainCriticality).toBe(0.8);
  });

  it('MEDIUM_DOMAINS (conductor-architecture) returns 0.6 criticality', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'conductor-architecture' }));
    expect(r.dimensions.domainCriticality).toBe(0.6);
  });

  it('LOW_DOMAINS (content) returns 0.4 criticality', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'content' }));
    expect(r.dimensions.domainCriticality).toBe(0.4);
  });

  it('unknown domain slug returns 0.3 criticality', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'totally-unknown-domain-xyz' }));
    expect(r.dimensions.domainCriticality).toBe(0.3);
  });

  it('RISK_HIGH_DOMAINS (testing-qa) returns 0.8 riskIfDelayed', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'testing-qa' }));
    expect(r.dimensions.riskIfDelayed).toBe(0.8);
  });

  it('non-risk domain returns 0.3 riskIfDelayed', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'theming-branding' }));
    expect(r.dimensions.riskIfDelayed).toBe(0.3);
  });

  it('user-visible domain (conductor-dashboard-features) returns 1.0 userVisible', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'conductor-dashboard-features' }));
    expect(r.dimensions.userVisible).toBe(1.0);
  });

  it('UI keyword in title returns 0.8 userVisible', () => {
    const r = scoreTask(makeCtx({ title: 'Update dashboard page layout' }));
    expect(r.dimensions.userVisible).toBe(0.8);
  });

  it('MEDIUM_DOMAIN returns 0.5 userVisible when not in user-visible set', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'conductor-architecture' }));
    expect(r.dimensions.userVisible).toBe(0.5);
  });

  it('blast radius: dependentCount 3 → 0.8', () => {
    const r = scoreTask(makeCtx({ dependentCount: 3 }));
    expect(r.dimensions.blastRadius).toBe(0.8);
  });

  it('blast radius: dependentCount 2 → 0.6', () => {
    const r = scoreTask(makeCtx({ dependentCount: 2 }));
    expect(r.dimensions.blastRadius).toBe(0.6);
  });

  it('blast radius: dependentCount 1 → 0.4', () => {
    const r = scoreTask(makeCtx({ dependentCount: 1 }));
    expect(r.dimensions.blastRadius).toBe(0.4);
  });

  it('urgency: HIGH_DOMAIN (backend-core) gives 0.6', () => {
    const r = scoreTask(makeCtx({ domainSlug: 'backend-core' }));
    expect(r.dimensions.urgency).toBe(0.6);
  });

  it('urgency: open blocker count > 0 gives 0.8', () => {
    const r = scoreTask(makeCtx({ openBlockerCount: 1 }));
    expect(r.dimensions.urgency).toBe(0.8);
  });

  it('urgency: long notes (>150 chars) gives 0.5', () => {
    const r = scoreTask(makeCtx({ notes: 'a'.repeat(151) }));
    expect(r.dimensions.urgency).toBe(0.5);
  });

  it('buildSummary includes "routine task" for low-scoring tasks', () => {
    const r = scoreTask(makeCtx({ domainSlug: null, title: 'Ordinary task', declaredFiles: [] }));
    expect(r.summary).toContain('routine task');
  });
});
