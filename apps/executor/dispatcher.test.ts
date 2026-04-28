import { selectModel, buildPrompt, MODEL_HAIKU, MODEL_SONNET, MODEL_OPUS } from './dispatcher';
import type { DispatchTask } from './dispatcher';

function makeTask(overrides: Partial<DispatchTask> = {}): DispatchTask {
  return {
    id: 't1',
    title: 'Default title',
    cwd: '/tmp/x',
    notes: null,
    declaredFiles: [],
    domainSlug: null,
    projectId: null,
    ...overrides,
  };
}

describe('selectModel', () => {
  it('defaults to Sonnet for unclassified tasks', () => {
    expect(selectModel(makeTask({ title: 'Implement user profile page' }))).toBe(MODEL_SONNET);
  });

  it('routes Haiku for low-complexity status/lookup tasks', () => {
    expect(selectModel(makeTask({ title: 'Verify deploy status of staging' }))).toBe(MODEL_HAIKU);
    expect(selectModel(makeTask({ title: 'Rename foo.ts to bar.ts (rename-only)' }))).toBe(MODEL_HAIKU);
    expect(selectModel(makeTask({ title: 'Trivial: 1-line config bump' }))).toBe(MODEL_HAIKU);
  });

  it('routes Opus for architecture/P0/multi-refactor tasks', () => {
    expect(selectModel(makeTask({ title: 'Design new event-bus architecture' }))).toBe(MODEL_OPUS);
    expect(selectModel(makeTask({ title: 'P0 outage fix' }))).toBe(MODEL_OPUS);
    expect(selectModel(makeTask({ title: 'Refactor-multi: split monolith into 4 services' }))).toBe(MODEL_OPUS);
  });

  it('canary tasks always go to Haiku', () => {
    expect(selectModel(makeTask({ notes: '{"canary":true}' }))).toBe(MODEL_HAIKU);
  });

  it('explicit notes.model override wins', () => {
    expect(selectModel(makeTask({ title: 'Verify status', notes: '{"model":"opus"}' }))).toBe(MODEL_OPUS);
    expect(selectModel(makeTask({ title: 'Architecture redesign', notes: '{"model":"haiku"}' }))).toBe(MODEL_HAIKU);
    expect(selectModel(makeTask({ title: 'Whatever', notes: '{"model":"claude-sonnet-4-6"}' }))).toBe('claude-sonnet-4-6');
  });

  it('Opus keyword wins over Haiku keyword when both present', () => {
    expect(selectModel(makeTask({ title: 'Architecture: verify status of services' }))).toBe(MODEL_OPUS);
  });

  it('inspects notes.kind/complexity/priority', () => {
    expect(selectModel(makeTask({ title: 'task', notes: '{"kind":"trivial"}' }))).toBe(MODEL_HAIKU);
    expect(selectModel(makeTask({ title: 'task', notes: '{"priority":"P0"}' }))).toBe(MODEL_OPUS);
  });
});

describe('buildPrompt', () => {
  it('uses stable prefix for prompt-cache reuse', () => {
    const a = buildPrompt(makeTask({ id: 't1', title: 'A' }));
    const b = buildPrompt(makeTask({ id: 't2', title: 'B' }));
    const prefixA = a.split('---')[0];
    const prefixB = b.split('---')[0];
    expect(prefixA).toBe(prefixB);
    expect(prefixA).toContain('Conductor worker');
    expect(prefixA).toContain('subagent');
  });

  it('puts variable task content after the stable prefix', () => {
    const p = buildPrompt(makeTask({ id: 'task-xyz', title: 'My task', notes: 'x', domainSlug: 'auth' }));
    const idx = p.indexOf('Task task-xyz');
    const prefixEnd = p.indexOf('---');
    expect(idx).toBeGreaterThan(prefixEnd);
    expect(p).toContain('Domain: auth');
    expect(p).toContain('Notes: x');
  });

  it('canary path stays minimal', () => {
    const p = buildPrompt(makeTask({ id: 'c1', notes: '{"canary":true}' }));
    expect(p).toContain('canary');
    expect(p.length).toBeLessThan(200);
  });

  it('shrinks variable per-task tail vs prior template', () => {
    // Prior template: ~150-char per-task variable section + ~440-char body each call.
    // New: ~50-char per-task tail + stable prefix (cached across calls in 5min window).
    const p = buildPrompt(makeTask({ id: 't1', title: 'X', cwd: '/a' }));
    const tail = p.split('---\n')[1] ?? '';
    expect(tail.length).toBeLessThan(120);
    // Sanity: full prompt still well under prior ~600-char baseline for trivial tasks.
    expect(p.length).toBeLessThan(600);
  });
});
