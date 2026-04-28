import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BlockersManager } from '../../src/blockers/manager';
import { QuestionsManager } from '../../src/questions/manager';
import type { CreateBlockerParams } from '../../src/blockers/types';
import type { CreateQuestionParams } from '../../src/questions/types';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-drain-test-'));
}

const blocker1: CreateBlockerParams = {
  title: 'Enable R2',
  severity: 'high',
  kind: 'approval',
  description: 'Enable Cloudflare R2',
  resolutionSteps: [{ order: 1, instruction: 'Go to CF dashboard' }],
  approvalButton: { label: 'Approve R2', payload: { feature: 'r2' } },
};

const question1: CreateQuestionParams = {
  title: 'Which CDN?',
  priority: 'normal',
  context: 'Pick a CDN for image delivery.',
  recommendations: [
    { id: 'rec_A', label: 'Cloudflare', rationale: 'Built-in with our account', isDefault: true },
    { id: 'rec_B', label: 'Fastly', rationale: 'Better analytics' },
  ],
};

describe('blocker_drain', () => {
  let tmpDir: string;
  let mgr: BlockersManager;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    mgr = new BlockersManager(tmpDir);
    await mgr.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('drain returns empty when nothing resolved', async () => {
    await mgr.create(blocker1);
    const result = mgr.drain();
    expect(result.resolvedBlockers).toHaveLength(0);
  });

  it('drain returns only newly-resolved items since last call', async () => {
    const b = await mgr.create(blocker1);
    await mgr.resolve(b.id, 'Done');

    const first = mgr.drain();
    expect(first.resolvedBlockers).toHaveLength(1);

    const second = mgr.drain(); // nothing new since last drain
    expect(second.resolvedBlockers).toHaveLength(0);
  });

  it('drain includes correct approval payload', async () => {
    const b = await mgr.create(blocker1);
    await mgr.resolve(b.id);

    const { resolvedBlockers } = mgr.drain();
    expect((resolvedBlockers[0]!.approvalPayload as { feature: string }).feature).toBe('r2');
  });

  it('drain accumulates multiple resolutions between calls', async () => {
    const b1 = await mgr.create(blocker1);
    const b2 = await mgr.create({ ...blocker1, title: 'Enable KV', approvalButton: { label: 'Approve KV', payload: { feature: 'kv' } } });

    await mgr.resolve(b1.id);
    await mgr.resolve(b2.id);

    const result = mgr.drain();
    expect(result.resolvedBlockers).toHaveLength(2);
  });

  it('cancelled blockers do not appear in drain', async () => {
    const b = await mgr.create(blocker1);
    await mgr.cancel(b.id);

    const result = mgr.drain();
    expect(result.resolvedBlockers).toHaveLength(0);
  });
});

describe('question_drain', () => {
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

  it('drain returns empty when nothing answered', async () => {
    await mgr.create(question1);
    const result = mgr.drain();
    expect(result.answeredQuestions).toHaveLength(0);
  });

  it('drain returns only newly-answered items since last call', async () => {
    const q = await mgr.create(question1);
    await mgr.answer(q.id, { kind: 'accepted-recommendation', recommendationId: 'rec_A' });

    const first = mgr.drain();
    expect(first.answeredQuestions).toHaveLength(1);

    const second = mgr.drain();
    expect(second.answeredQuestions).toHaveLength(0);
  });

  it('drain includes the answer detail', async () => {
    const q = await mgr.create(question1);
    await mgr.answer(q.id, { kind: 'custom', customText: 'Use Bunny CDN' });

    const { answeredQuestions } = mgr.drain();
    expect(answeredQuestions[0]!.question.answer?.customText).toBe('Use Bunny CDN');
  });

  it('drain accumulates multiple answers between calls', async () => {
    const q1 = await mgr.create(question1);
    const q2 = await mgr.create({ ...question1, title: 'Which DB?' });

    await mgr.answer(q1.id, { kind: 'accepted-recommendation', recommendationId: 'rec_A' });
    await mgr.answer(q2.id, { kind: 'custom', customText: 'PostgreSQL' });

    const result = mgr.drain();
    expect(result.answeredQuestions).toHaveLength(2);
  });

  it('cancelled questions do not appear in drain', async () => {
    const q = await mgr.create(question1);
    await mgr.cancel(q.id);

    const result = mgr.drain();
    expect(result.answeredQuestions).toHaveLength(0);
  });
});
