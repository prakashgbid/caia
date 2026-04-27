import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RequirementsManager } from '../../src/requirements/manager';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-mgr-test-'));
}

describe('RequirementsManager', () => {
  let tmpDir: string;
  let mgr: RequirementsManager;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    mgr = new RequirementsManager(tmpDir);
    await mgr.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('creates conductor directory', () => {
      expect(fs.existsSync(tmpDir)).toBe(true);
    });

    it('starts with empty state', () => {
      expect(mgr.list()).toHaveLength(0);
    });
  });

  describe('capture', () => {
    it('creates a requirement with req_ prefix id', async () => {
      const req = await mgr.capture({ title: 'Test', description: 'desc' });
      expect(req.id).toMatch(/^req_/);
    });

    it('sets default priority to 3', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D' });
      expect(req.priority).toBe(3);
    });

    it('respects custom priority', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D', priority: 1 });
      expect(req.priority).toBe(1);
    });

    it('starts in captured state', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D' });
      expect(req.state).toBe('captured');
    });

    it('stores labels and targetProject', async () => {
      const req = await mgr.capture({
        title: 'T', description: 'D',
        labels: ['ui', 'backend'],
        targetProject: '~/my-project',
      });
      expect(req.labels).toEqual(['ui', 'backend']);
      expect(req.targetProject).toBe('~/my-project');
    });

    it('persists to jsonl event log', async () => {
      await mgr.capture({ title: 'T', description: 'D' });
      const eventsPath = path.join(tmpDir, 'requirements.jsonl');
      expect(fs.existsSync(eventsPath)).toBe(true);
      const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
      expect(lines.length).toBeGreaterThan(0);
    });
  });

  describe('refine', () => {
    it('updates description', async () => {
      const req = await mgr.capture({ title: 'T', description: 'original' });
      const updated = await mgr.refine(req.id, { description: 'updated' });
      expect(updated.description).toBe('updated');
    });

    it('updates estimatedFiles', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D' });
      const updated = await mgr.refine(req.id, { estimatedFiles: ['src/**'] });
      expect(updated.estimatedFiles).toEqual(['src/**']);
    });

    it('updates spec', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D' });
      const spec = { goals: ['goal1'], nonGoals: ['ng1'], acceptanceCriteria: ['ac1'], notes: 'n' };
      const updated = await mgr.refine(req.id, { spec });
      expect(updated.spec?.goals).toEqual(['goal1']);
    });

    it('throws for unknown id', async () => {
      await expect(mgr.refine('req_missing', { description: 'x' })).rejects.toThrow(/not found/);
    });
  });

  describe('setState', () => {
    it('advances through valid states', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D' });
      const r2 = await mgr.setState(req.id, 'refining');
      expect(r2.state).toBe('refining');
      const r3 = await mgr.setState(req.id, 'specced');
      expect(r3.state).toBe('specced');
    });

    it('rejects invalid transition', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D' });
      await expect(mgr.setState(req.id, 'done')).rejects.toThrow(/Invalid state transition/);
    });

    it('throws for unknown id', async () => {
      await expect(mgr.setState('req_missing', 'refining')).rejects.toThrow(/not found/);
    });
  });

  describe('addNote', () => {
    it('appends a note with timestamp', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D' });
      const updated = await mgr.addNote(req.id, 'First note');
      expect(updated.notes).toHaveLength(1);
      expect(updated.notes[0]!.text).toBe('First note');
      expect(updated.notes[0]!.ts).toBeTruthy();
    });

    it('preserves existing notes', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D' });
      await mgr.addNote(req.id, 'Note 1');
      await mgr.addNote(req.id, 'Note 2');
      const updated = mgr.get(req.id)!;
      expect(updated.notes).toHaveLength(2);
    });
  });

  describe('list', () => {
    it('returns all requirements without filter', async () => {
      await mgr.capture({ title: 'A', description: 'a' });
      await mgr.capture({ title: 'B', description: 'b' });
      expect(mgr.list()).toHaveLength(2);
    });

    it('filters by state', async () => {
      const a = await mgr.capture({ title: 'A', description: 'a' });
      await mgr.capture({ title: 'B', description: 'b' });
      await mgr.setState(a.id, 'refining');
      expect(mgr.list({ state: 'refining' })).toHaveLength(1);
      expect(mgr.list({ state: 'captured' })).toHaveLength(1);
    });

    it('filters by labels', async () => {
      await mgr.capture({ title: 'A', description: 'a', labels: ['ui', 'backend'] });
      await mgr.capture({ title: 'B', description: 'b', labels: ['api'] });
      const ui = mgr.list({ labels: ['ui'] });
      expect(ui).toHaveLength(1);
      expect(ui[0]!.title).toBe('A');
    });

    it('filters by priority', async () => {
      await mgr.capture({ title: 'A', description: 'a', priority: 1 });
      await mgr.capture({ title: 'B', description: 'b', priority: 3 });
      expect(mgr.list({ priority: 1 })).toHaveLength(1);
    });
  });

  describe('pickupNext', () => {
    it('returns null when no ready requirements', async () => {
      await mgr.capture({ title: 'T', description: 'D' });
      expect(await mgr.pickupNext()).toBeNull();
    });

    it('picks highest priority ready requirement', async () => {
      const advance = async (title: string, p: 1|2|3) => {
        const r = await mgr.capture({ title, description: 'd', priority: p });
        await mgr.setState(r.id, 'refining');
        await mgr.setState(r.id, 'specced');
        await mgr.setState(r.id, 'ready');
        return r;
      };
      await advance('P3', 3);
      const p1 = await advance('P1', 1);
      const picked = await mgr.pickupNext();
      expect(picked!.id).toBe(p1.id);
    });

    it('claims picked requirement as executing', async () => {
      const r = await mgr.capture({ title: 'T', description: 'D' });
      await mgr.setState(r.id, 'refining');
      await mgr.setState(r.id, 'specced');
      await mgr.setState(r.id, 'ready');
      await mgr.pickupNext();
      expect(mgr.get(r.id)!.state).toBe('executing');
    });
  });

  describe('markDone', () => {
    it('moves executing → verifying → done', async () => {
      const r = await mgr.capture({ title: 'T', description: 'D' });
      await mgr.setState(r.id, 'refining');
      await mgr.setState(r.id, 'specced');
      await mgr.setState(r.id, 'ready');
      await mgr.setState(r.id, 'executing');
      const done = await mgr.markDone(r.id);
      expect(done.state).toBe('done');
    });

    it('moves verifying → done', async () => {
      const r = await mgr.capture({ title: 'T', description: 'D' });
      await mgr.setState(r.id, 'refining');
      await mgr.setState(r.id, 'specced');
      await mgr.setState(r.id, 'ready');
      await mgr.setState(r.id, 'executing');
      await mgr.setState(r.id, 'verifying');
      const done = await mgr.markDone(r.id);
      expect(done.state).toBe('done');
    });

    it('throws if not executing or verifying', async () => {
      const r = await mgr.capture({ title: 'T', description: 'D' });
      await expect(mgr.markDone(r.id)).rejects.toThrow(/Cannot mark done/);
    });
  });

  describe('persistence', () => {
    it('state survives reload', async () => {
      const req = await mgr.capture({ title: 'Persist', description: 'test' });
      await mgr.setState(req.id, 'refining');

      // Fresh manager from same directory
      const fresh = new RequirementsManager(tmpDir);
      await fresh.init();
      const found = fresh.get(req.id);
      expect(found).toBeDefined();
      expect(found!.state).toBe('refining');
      expect(found!.title).toBe('Persist');
    });

    it('rebuilds from event log after snapshot corruption', async () => {
      const req = await mgr.capture({ title: 'T', description: 'D' });
      await mgr.setState(req.id, 'refining');

      // Corrupt the snapshot
      const snap = path.join(tmpDir, 'requirements.snapshot.json');
      fs.writeFileSync(snap, 'CORRUPTED {{{');

      const fresh = new RequirementsManager(tmpDir);
      await fresh.init();
      const found = fresh.get(req.id);
      expect(found?.state).toBe('refining');
    });
  });
});
