import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RequirementsManager } from '../../src/requirements/manager';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-req-test-'));
}

describe('RequirementsManager — dependency management', () => {
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

  describe('addDependency', () => {
    it('adds a valid dependency', async () => {
      const a = await mgr.capture({ title: 'A', description: 'desc A' });
      const b = await mgr.capture({ title: 'B', description: 'desc B' });
      await mgr.addDependency(b.id, a.id);
      const updated = mgr.get(b.id)!;
      expect(updated.dependsOn).toContain(a.id);
    });

    it('throws if dependency target not found', async () => {
      const a = await mgr.capture({ title: 'A', description: 'desc' });
      await expect(mgr.addDependency(a.id, 'req_nonexistent')).rejects.toThrow(/not found/);
    });

    it('does not duplicate existing dependency', async () => {
      const a = await mgr.capture({ title: 'A', description: 'desc A' });
      const b = await mgr.capture({ title: 'B', description: 'desc B' });
      await mgr.addDependency(b.id, a.id);
      await mgr.addDependency(b.id, a.id);
      const updated = mgr.get(b.id)!;
      expect(updated.dependsOn.filter(d => d === a.id)).toHaveLength(1);
    });
  });

  describe('cycle detection', () => {
    it('detects direct cycle (A → B, B → A)', async () => {
      const a = await mgr.capture({ title: 'A', description: 'desc A' });
      const b = await mgr.capture({ title: 'B', description: 'desc B' });
      await mgr.addDependency(b.id, a.id);   // B depends on A
      await expect(mgr.addDependency(a.id, b.id)).rejects.toThrow(/cycle/);
    });

    it('detects indirect cycle (A → B → C → A)', async () => {
      const a = await mgr.capture({ title: 'A', description: 'a' });
      const b = await mgr.capture({ title: 'B', description: 'b' });
      const c = await mgr.capture({ title: 'C', description: 'c' });
      await mgr.addDependency(b.id, a.id);  // B → A
      await mgr.addDependency(c.id, b.id);  // C → B (so C → B → A)
      // A → C would create A → C → B → A
      await expect(mgr.addDependency(a.id, c.id)).rejects.toThrow(/cycle/);
    });

    it('allows valid DAG (A → B, A → C, no cycles)', async () => {
      const a = await mgr.capture({ title: 'A', description: 'a' });
      const b = await mgr.capture({ title: 'B', description: 'b' });
      const c = await mgr.capture({ title: 'C', description: 'c' });
      await expect(mgr.addDependency(b.id, a.id)).resolves.toBeDefined();
      await expect(mgr.addDependency(c.id, a.id)).resolves.toBeDefined();
    });

    it('self-dependency is a cycle', async () => {
      const a = await mgr.capture({ title: 'A', description: 'a' });
      await expect(mgr.addDependency(a.id, a.id)).rejects.toThrow(/cycle/);
    });
  });

  describe('allDepsDone', () => {
    it('returns true when dependsOn is empty', async () => {
      const a = await mgr.capture({ title: 'A', description: 'a' });
      expect(mgr.allDepsDone(a)).toBe(true);
    });

    it('returns false when a dependency is not done', async () => {
      const a = await mgr.capture({ title: 'A', description: 'a' });
      const b = await mgr.capture({ title: 'B', description: 'b' });
      await mgr.addDependency(b.id, a.id);
      // a is in 'captured' state, not done
      const bReq = mgr.get(b.id)!;
      expect(mgr.allDepsDone(bReq)).toBe(false);
    });

    it('returns true when all dependencies are done', async () => {
      const a = await mgr.capture({ title: 'A', description: 'a' });
      const b = await mgr.capture({ title: 'B', description: 'b' });
      await mgr.addDependency(b.id, a.id);

      // Manually advance a to done through states
      await mgr.setState(a.id, 'refining');
      await mgr.setState(a.id, 'specced');
      await mgr.setState(a.id, 'ready');
      await mgr.setState(a.id, 'executing');
      await mgr.setState(a.id, 'verifying');
      await mgr.setState(a.id, 'done');

      const bReq = mgr.get(b.id)!;
      expect(mgr.allDepsDone(bReq)).toBe(true);
    });
  });
});
