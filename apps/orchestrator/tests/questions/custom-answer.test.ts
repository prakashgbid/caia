import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QuestionsManager } from '../../src/questions/manager';
import type { CreateQuestionParams } from '../../src/questions/types';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-qst-test-'));
}

const baseParams: CreateQuestionParams = {
  title: 'Which storage backend?',
  priority: 'normal',
  context: 'We need to pick a storage provider for user uploads.',
  recommendations: [
    { id: 'rec_A', label: 'Cloudflare R2', rationale: 'No egress fees', isDefault: true },
    { id: 'rec_B', label: 'AWS S3', rationale: 'More mature tooling' },
  ],
  customAnswerPlaceholder: 'Describe an alternative...',
};

describe('QuestionsManager — custom-answer path', () => {
  let tmpDir: string;
  let mgr: QuestionsManager;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    mgr = new QuestionsManager(tmpDir);
    await mgr.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a question with qst_ prefix id', async () => {
    const q = await mgr.create(baseParams);
    expect(q.id).toMatch(/^qst_/);
  });

  it('starts in open state', async () => {
    const q = await mgr.create(baseParams);
    expect(q.state).toBe('open');
  });

  it('accepts a recommendation answer', async () => {
    const q = await mgr.create(baseParams);
    const answered = await mgr.answer(q.id, {
      kind: 'accepted-recommendation',
      recommendationId: 'rec_A',
    });
    expect(answered.state).toBe('answered');
    expect(answered.answer?.kind).toBe('accepted-recommendation');
    expect(answered.answer?.recommendationId).toBe('rec_A');
  });

  it('accepts a custom text answer', async () => {
    const q = await mgr.create(baseParams);
    const answered = await mgr.answer(q.id, {
      kind: 'custom',
      customText: 'Use Backblaze B2 — cheapest option',
    });
    expect(answered.state).toBe('answered');
    expect(answered.answer?.kind).toBe('custom');
    expect(answered.answer?.customText).toBe('Use Backblaze B2 — cheapest option');
  });

  it('drain returns answered question', async () => {
    const q = await mgr.create(baseParams);
    await mgr.answer(q.id, { kind: 'custom', customText: 'Go with B2' });

    const result = mgr.drain();
    expect(result.answeredQuestions).toHaveLength(1);
    expect(result.answeredQuestions[0]!.question.state).toBe('answered');
    expect(result.answeredQuestions[0]!.question.answer?.customText).toBe('Go with B2');
  });

  it('drain is idempotent — second call returns empty', async () => {
    const q = await mgr.create(baseParams);
    await mgr.answer(q.id, { kind: 'accepted-recommendation', recommendationId: 'rec_B' });

    mgr.drain();
    const second = mgr.drain();
    expect(second.answeredQuestions).toHaveLength(0);
  });

  it('openCount decreases after answering', async () => {
    await mgr.create(baseParams);
    await mgr.create({ ...baseParams, title: 'Q2' });
    expect(mgr.openCount()).toBe(2);

    const q = mgr.list('open')[0]!;
    await mgr.answer(q.id, { kind: 'custom', customText: 'answer' });
    expect(mgr.openCount()).toBe(1);
  });

  it('throws when answering with unknown recommendation id', async () => {
    const q = await mgr.create(baseParams);
    await expect(
      mgr.answer(q.id, { kind: 'accepted-recommendation', recommendationId: 'rec_Z' }),
    ).rejects.toThrow(/Recommendation not found/);
  });

  it('cannot answer an already-answered question', async () => {
    const q = await mgr.create(baseParams);
    await mgr.answer(q.id, { kind: 'custom', customText: 'first' });
    await expect(
      mgr.answer(q.id, { kind: 'custom', customText: 'second' }),
    ).rejects.toThrow(/Invalid question transition/);
  });

  it('can cancel an open question', async () => {
    const q = await mgr.create(baseParams);
    const cancelled = await mgr.cancel(q.id);
    expect(cancelled.state).toBe('cancelled');
  });

  it('persists to jsonl event log', async () => {
    await mgr.create(baseParams);
    const eventsPath = path.join(tmpDir, 'questions.jsonl');
    expect(fs.existsSync(eventsPath)).toBe(true);
    const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('survives init from existing event log', async () => {
    const q = await mgr.create(baseParams);
    await mgr.answer(q.id, { kind: 'custom', customText: 'persisted' });

    // New manager instance, same dir
    const mgr2 = new QuestionsManager(tmpDir);
    await mgr2.init();
    const loaded = mgr2.get(q.id);
    expect(loaded?.state).toBe('answered');
    expect(loaded?.answer?.customText).toBe('persisted');
  });
});
