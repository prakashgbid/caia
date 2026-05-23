import { describe, expect, it } from 'vitest';
import { InterviewerError, MemoryInterviewerPersistence, tenantSchemaName } from '../src/index.js';

const NEW_ID = () => '00000000-0000-0000-0000-000000000001';

describe('tenantSchemaName', () => {
  it('returns caia_<slug-underscored> for valid slugs', () => {
    expect(tenantSchemaName('pt')).toBe('caia_pt');
    expect(tenantSchemaName('prakash-tiwari')).toBe('caia_prakash_tiwari');
    expect(tenantSchemaName('ab')).toBe('caia_ab');
  });

  it('rejects invalid slugs (defence-in-depth against SQL identifier injection)', () => {
    expect(() => tenantSchemaName('Invalid')).toThrowError(InterviewerError);
    expect(() => tenantSchemaName('1abc')).toThrowError(InterviewerError);
    expect(() => tenantSchemaName('drop;--')).toThrowError(InterviewerError);
    expect(() => tenantSchemaName('a'.repeat(50))).toThrowError(InterviewerError);
  });
});

describe('MemoryInterviewerPersistence', () => {
  it('creates and retrieves an interview', async () => {
    const p = new MemoryInterviewerPersistence();
    await p.ensureSchema('pt');
    const id = NEW_ID();
    const row = await p.createInterview({ id, tenantSlug: 'pt', operatorEmail: 'op@example.com', grandIdeaPrompt: 'idea' });
    expect(row.id).toBe(id);
    expect(row.state).toBe('INIT');
    const loaded = await p.loadInterview('pt', id);
    expect(loaded.interview.id).toBe(id);
  });

  it('rejects duplicate ids', async () => {
    const p = new MemoryInterviewerPersistence();
    const id = NEW_ID();
    await p.createInterview({ id, tenantSlug: 'pt', operatorEmail: 'op@example.com', grandIdeaPrompt: 'x' });
    await expect(p.createInterview({ id, tenantSlug: 'pt', operatorEmail: 'op@example.com', grandIdeaPrompt: 'y' })).rejects.toThrowError(InterviewerError);
  });

  it('appends turns and rejects duplicates', async () => {
    const p = new MemoryInterviewerPersistence();
    const id = NEW_ID();
    await p.createInterview({ id, tenantSlug: 'pt', operatorEmail: 'op@example.com', grandIdeaPrompt: 'x' });
    await p.appendTurn({ id: 't-1', interviewId: id, tenantSlug: 'pt', turnNumber: 1, role: 'agent', content: 'Q1', askedAt: new Date() });
    await expect(p.appendTurn({ id: 't-2', interviewId: id, tenantSlug: 'pt', turnNumber: 1, role: 'agent', content: 'dup', askedAt: new Date() })).rejects.toThrowError(InterviewerError);
  });

  it('snapshots are idempotent on revisionNumber', async () => {
    const p = new MemoryInterviewerPersistence();
    const id = NEW_ID();
    await p.createInterview({ id, tenantSlug: 'pt', operatorEmail: 'op@example.com', grandIdeaPrompt: 'x' });
    const rubric = { perPillarCoverage: {} as Record<string, number>, dimensions: {} as Record<string, number>, aggregateScore: 50 };
    await p.snapshotRevision({ interviewId: id, tenantSlug: 'pt', revisionNumber: 1, atTurnNumber: 1, document: {} as never, rubricScores: rubric as never, satisfactionScore: 50 });
    await p.snapshotRevision({ interviewId: id, tenantSlug: 'pt', revisionNumber: 1, atTurnNumber: 2, document: {} as never, rubricScores: rubric as never, satisfactionScore: 60 });
    expect(p.getRevisions(id)).toHaveLength(1);
  });

  it('updateState mutates the interview row', async () => {
    const p = new MemoryInterviewerPersistence();
    const id = NEW_ID();
    await p.createInterview({ id, tenantSlug: 'pt', operatorEmail: 'op@example.com', grandIdeaPrompt: 'x' });
    await p.updateState({ interviewId: id, tenantSlug: 'pt', state: 'PLANNING', turnNumber: 1, llmCallCount: 3 });
    const loaded = await p.loadInterview('pt', id);
    expect(loaded.interview.state).toBe('PLANNING');
    expect(loaded.interview.turnNumber).toBe(1);
  });

  it('forceClose records FORCE_CLOSED + closeReason', async () => {
    const p = new MemoryInterviewerPersistence();
    const id = NEW_ID();
    await p.createInterview({ id, tenantSlug: 'pt', operatorEmail: 'op@example.com', grandIdeaPrompt: 'x' });
    await p.forceClose({ interviewId: id, tenantSlug: 'pt', closeReason: 'operator_force', closedBy: 'op@example.com' });
    const loaded = await p.loadInterview('pt', id);
    expect(loaded.interview.state).toBe('FORCE_CLOSED');
    expect(loaded.interview.closeReason).toBe('operator_force');
  });

  it('resumeInterview transitions PAUSED → PLANNING', async () => {
    const p = new MemoryInterviewerPersistence();
    const id = NEW_ID();
    await p.createInterview({ id, tenantSlug: 'pt', operatorEmail: 'op@example.com', grandIdeaPrompt: 'x' });
    await p.updateState({ interviewId: id, tenantSlug: 'pt', state: 'PAUSED' });
    await p.resumeInterview({ interviewId: id, tenantSlug: 'pt' });
    const loaded = await p.loadInterview('pt', id);
    expect(loaded.interview.state).toBe('PLANNING');
  });

  it('markDeferred increments per-question defer counts', async () => {
    const p = new MemoryInterviewerPersistence();
    const id = NEW_ID();
    await p.createInterview({ id, tenantSlug: 'pt', operatorEmail: 'op@example.com', grandIdeaPrompt: 'x' });
    await p.markDeferred({ interviewId: id, tenantSlug: 'pt', questionId: 'B5-Q01', askedAtTurn: 1, reason: 'user_skipped' });
    await p.markDeferred({ interviewId: id, tenantSlug: 'pt', questionId: 'B5-Q01', askedAtTurn: 5, reason: 'user_skipped' });
    expect(p.getDeferralCounts(id)['B5-Q01']).toBe(2);
  });

  it('loadInterview throws on unknown id', async () => {
    const p = new MemoryInterviewerPersistence();
    await expect(p.loadInterview('pt', '00000000-0000-0000-0000-000000000009')).rejects.toThrowError(InterviewerError);
  });
});
