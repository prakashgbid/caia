import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BlockersManager } from '../../src/blockers/manager';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-blk-test-'));
}

describe('Blocker approval payload', () => {
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

  it('creates a blocker with an approvalButton', async () => {
    const blocker = await mgr.create({
      title: 'Approve CF R2',
      severity: 'high',
      kind: 'approval',
      description: 'Enable R2 in Cloudflare',
      resolutionSteps: [{ order: 1, instruction: 'Go to CF dashboard and enable R2' }],
      approvalButton: { label: 'Approve Cloudflare R2 enable', payload: { feature: 'r2', accountId: 'abc123' } },
    });

    expect(blocker.approvalButton?.label).toBe('Approve Cloudflare R2 enable');
    expect(blocker.approvalButton?.payload).toEqual({ feature: 'r2', accountId: 'abc123' });
  });

  it('drain returns approval payload when blocker is resolved', async () => {
    const blocker = await mgr.create({
      title: 'Approve CF R2',
      severity: 'high',
      kind: 'approval',
      description: 'Enable R2 in Cloudflare',
      resolutionSteps: [{ order: 1, instruction: 'Enable R2' }],
      approvalButton: { label: 'Approve', payload: { feature: 'r2' } },
    });

    await mgr.resolve(blocker.id, 'Approved via dashboard button');

    const result = mgr.drain();
    expect(result.resolvedBlockers).toHaveLength(1);
    expect(result.resolvedBlockers[0]!.approvalPayload).toEqual({ feature: 'r2' });
    expect(result.resolvedBlockers[0]!.blocker.state).toBe('resolved');
  });

  it('drain is idempotent — second call returns empty', async () => {
    const blocker = await mgr.create({
      title: 'Approve CF R2',
      severity: 'normal',
      kind: 'approval',
      description: 'Enable R2',
      resolutionSteps: [{ order: 1, instruction: 'Enable' }],
      approvalButton: { label: 'Approve', payload: { done: true } },
    });
    await mgr.resolve(blocker.id);

    mgr.drain(); // first drain clears the queue
    const second = mgr.drain();
    expect(second.resolvedBlockers).toHaveLength(0);
  });

  it('drain returns correct payload for multiple resolved blockers', async () => {
    const b1 = await mgr.create({
      title: 'Approve X',
      severity: 'high',
      kind: 'approval',
      description: 'Approve X',
      resolutionSteps: [{ order: 1, instruction: 'Do X' }],
      approvalButton: { label: 'Approve X', payload: { id: 'x' } },
    });
    const b2 = await mgr.create({
      title: 'Approve Y',
      severity: 'normal',
      kind: 'approval',
      description: 'Approve Y',
      resolutionSteps: [{ order: 1, instruction: 'Do Y' }],
      approvalButton: { label: 'Approve Y', payload: { id: 'y' } },
    });

    await mgr.resolve(b1.id);
    await mgr.resolve(b2.id);

    const result = mgr.drain();
    expect(result.resolvedBlockers).toHaveLength(2);
    const payloads = result.resolvedBlockers.map((r) => (r.approvalPayload as { id: string }).id);
    expect(payloads).toContain('x');
    expect(payloads).toContain('y');
  });

  it('drain returns no approvalPayload for blocker without approvalButton', async () => {
    const blocker = await mgr.create({
      title: 'Plain blocker',
      severity: 'low',
      kind: 'info',
      description: 'Just info',
      resolutionSteps: [{ order: 1, instruction: 'Read the docs' }],
    });
    await mgr.resolve(blocker.id);

    const result = mgr.drain();
    expect(result.resolvedBlockers[0]!.approvalPayload).toBeUndefined();
  });

  it('cannot resolve an already-resolved blocker', async () => {
    const blocker = await mgr.create({
      title: 'Double resolve test',
      severity: 'normal',
      kind: 'info',
      description: 'Test',
      resolutionSteps: [{ order: 1, instruction: 'Do it' }],
    });
    await mgr.resolve(blocker.id);
    await expect(mgr.resolve(blocker.id)).rejects.toThrow(/Invalid blocker transition/);
  });
});
