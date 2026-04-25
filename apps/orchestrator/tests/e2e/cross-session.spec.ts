import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Conductor } from '../../src/index';
import { createHealthServer } from '../../src/http/health';
import * as http from 'http';

let tmpDir: string;

test.beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-e2e-cs-'));
});

test.afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test.describe('Cross-session state recovery', () => {
  test('state rebuilt from event log after new conversation', async () => {
    // Session 1: create tasks
    const c1 = new Conductor(tmpDir);
    await c1.init();

    const rA = await c1.add({ title: 'Task A', cwd: '/tmp', files: ['src/a.ts'] });
    const rB = await c1.add({ title: 'Task B', cwd: '/tmp', files: ['src/b.ts'] });
    await c1.start(rA.id);
    await c1.complete(rA.id, ['src/a.ts']);

    const stateFromSession1 = c1.status();
    expect(Object.keys(stateFromSession1.tasks)).toHaveLength(2);

    // Session 2: new conversation — new conductor instance, same dir
    const c2 = new Conductor(tmpDir);
    await c2.init();

    const stateFromSession2 = c2.status();
    // All tasks should be present
    expect(stateFromSession2.tasks[rA.id]).toBeDefined();
    expect(stateFromSession2.tasks[rB.id]).toBeDefined();

    // Task A should be completed
    expect(stateFromSession2.tasks[rA.id]!.status).toBe('completed');
    // Task B should be queued
    expect(stateFromSession2.tasks[rB.id]!.status).toBe('queued');

    await c2.shutdown?.();
  });

  test('state can be rebuilt from event log when snapshot is deleted', async () => {
    const rebuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-rebuild-'));

    try {
      const c1 = new Conductor(rebuildDir);
      await c1.init();

      const r = await c1.add({ title: 'Rebuild test', cwd: '/tmp', files: ['src/rb.ts'] });
      await c1.start(r.id);

      // Delete snapshot
      const snapshotPath = path.join(rebuildDir, 'state.snapshot.json');
      if (fs.existsSync(snapshotPath)) {
        fs.unlinkSync(snapshotPath);
      }

      // New session rebuilds from event log
      const c2 = new Conductor(rebuildDir);
      await c2.init();

      const state = c2.status();
      expect(state.tasks[r.id]).toBeDefined();
      expect(state.tasks[r.id]!.status).toBe('running');

      await c2.shutdown?.();
    } finally {
      fs.rmSync(rebuildDir, { recursive: true, force: true });
    }
  });

  test('dashboard shows correct state via HTTP after session switch', async ({ page }) => {
    const dashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-e2e-dash-'));
    let dashServer: http.Server | null = null;

    try {
      // Session 1
      const c1 = new Conductor(dashDir);
      await c1.init();
      await c1.add({ title: 'Dashboard task', cwd: '/tmp', files: ['src/d.ts'] });

      // Session 2 with HTTP server
      const c2 = new Conductor(dashDir);
      await c2.init();
      dashServer = createHealthServer(c2, 17779);
      await new Promise<void>(resolve => dashServer!.listen(17779, resolve));

      // Navigate to health endpoint
      const response = await page.request.get('http://localhost:17779/health');
      expect(response.ok()).toBe(true);
      const data = await response.json() as Record<string, unknown>;
      expect(data['ok']).toBe(true);

      const tasksResp = await page.request.get('http://localhost:17779/tasks');
      const tasks = await tasksResp.json() as unknown[];
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThan(0);

      await c2.shutdown?.();
    } finally {
      if (dashServer) {
        await new Promise<void>(resolve => dashServer!.close(() => resolve()));
      }
      fs.rmSync(dashDir, { recursive: true, force: true });
    }
  });
});
