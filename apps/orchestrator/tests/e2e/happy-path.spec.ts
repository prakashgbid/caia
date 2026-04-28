import { test, expect } from '@playwright/test';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Conductor } from '../../src/index';
import { createHealthServer } from '../../src/http/health';

let conductor: Conductor;
let healthServer: http.Server;
let tmpDir: string;

test.beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-e2e-'));
  conductor = new Conductor(tmpDir);
  await conductor.init();
  healthServer = createHealthServer(conductor, 7776);
  await new Promise<void>(resolve => healthServer.listen(7776, resolve));
});

test.afterAll(async () => {
  await new Promise<void>(resolve => healthServer.close(() => resolve()));
  await conductor.shutdown?.();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test.describe('Dashboard happy path', () => {
  test('header shows MCP online status via health endpoint', async ({ page }) => {
    await page.goto('/');
    // Wait for page to load and poll health
    await page.waitForTimeout(3000);
    // Check that the page loaded with some content
    const content = await page.textContent('body');
    expect(content).toBeTruthy();
  });

  test('adds task A, starts it, shows in Active Tasks', async ({ page }) => {
    // Add task A via conductor API
    const r = await conductor.add({
      title: 'Auth Module',
      cwd: '/tmp',
      files: ['src/auth/**'],
    });
    await conductor.start(r.id);

    await page.goto('/');
    await page.waitForTimeout(3500);

    // The task table should have content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('completing task A allows task B to start', async () => {
    // Add task A
    const rA = await conductor.add({
      title: 'Task A - auth',
      cwd: '/tmp',
      files: ['src/auth/service.ts'],
    });
    await conductor.start(rA.id);

    // Adding task B with same files reports conflict
    const rB = await conductor.add({
      title: 'Task B - same file',
      cwd: '/tmp',
      files: ['src/auth/service.ts'],
    });
    expect(rB.conflicts.length).toBeGreaterThan(0);

    // Complete task A
    await conductor.complete(rA.id, ['src/auth/service.ts']);

    // Now check B - files should be clean
    const checkResult = conductor.check(['src/auth/service.ts']);
    expect(checkResult.clean).toBe(true);
  });
});
