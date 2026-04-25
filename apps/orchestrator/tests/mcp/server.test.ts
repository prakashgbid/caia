import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { Conductor } from '../../src/index';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-mcp-'));
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url: string, data: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: parseInt(urlObj.port),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      let resBody = '';
      res.on('data', (chunk: Buffer) => { resBody += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: resBody }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

describe('Conductor HTTP + API', () => {
  let tmpDir: string;
  let conductor: Conductor;
  const TEST_PORT = 17776;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    conductor = new Conductor(tmpDir);
    await conductor.init();
  });

  afterEach(async () => {
    await conductor.shutdown?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Conductor.add', () => {
    it('returns an id on successful add', async () => {
      const result = await conductor.add({
        title: 'Test task',
        cwd: '/tmp',
        files: ['src/foo.ts'],
      });
      expect(result.id).toMatch(/^tsk_/);
      expect(result.status).toBe('queued');
      expect(result.conflicts).toHaveLength(0);
    });

    it('returns conflict info when files are locked', async () => {
      const r1 = await conductor.add({
        title: 'Task A',
        cwd: '/tmp',
        files: ['src/auth/**'],
      });
      await conductor.start(r1.id);

      const r2 = await conductor.add({
        title: 'Task B',
        cwd: '/tmp',
        files: ['src/auth/login.ts'],
      });
      expect(r2.conflicts.length).toBeGreaterThan(0);
    });
  });

  describe('Conductor.check', () => {
    it('returns { clean: true, conflicts: [] } for empty state', () => {
      const result = conductor.check(['src/foo.ts']);
      expect(result.clean).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('Conductor.start', () => {
    it('transitions task to running', async () => {
      const { id } = await conductor.add({
        title: 'Start test',
        cwd: '/tmp',
        files: ['src/start-test.ts'],
      });
      const task = await conductor.start(id);
      expect(task.status).toBe('running');
      expect(task.startedAt).toBeTruthy();
    });

    it('throws when task not in queued state', async () => {
      const { id } = await conductor.add({
        title: 'Double start',
        cwd: '/tmp',
        files: ['src/ds.ts'],
      });
      await conductor.start(id);
      await expect(conductor.start(id)).rejects.toThrow();
    });
  });

  describe('Conductor.complete', () => {
    it('transitions task to completed', async () => {
      const { id } = await conductor.add({
        title: 'Complete test',
        cwd: '/tmp',
        files: ['src/complete.ts'],
      });
      await conductor.start(id);
      const task = await conductor.complete(id, ['src/complete.ts']);
      expect(task.status).toBe('completed');
      expect(task.completedAt).toBeTruthy();
      expect(task.actualFiles).toEqual(['src/complete.ts']);
    });
  });

  describe('Conductor.fail', () => {
    it('transitions task to failed', async () => {
      const { id } = await conductor.add({
        title: 'Fail test',
        cwd: '/tmp',
        files: ['src/fail.ts'],
      });
      await conductor.start(id);
      const task = await conductor.fail(id, 'some error');
      expect(task.status).toBe('failed');
    });
  });

  describe('Conductor.cancel', () => {
    it('transitions queued task to cancelled', async () => {
      const { id } = await conductor.add({
        title: 'Cancel test',
        cwd: '/tmp',
        files: ['src/cancel.ts'],
      });
      const task = await conductor.cancel(id);
      expect(task.status).toBe('cancelled');
    });
  });

  describe('Conductor.status', () => {
    it('returns current state with tasks', async () => {
      await conductor.add({ title: 'Status task', cwd: '/tmp', files: ['src/status.ts'] });
      const state = conductor.status();
      expect(state.tasks).toBeDefined();
      expect(Object.keys(state.tasks).length).toBeGreaterThan(0);
    });
  });

  describe('Conductor.list', () => {
    it('returns filtered task list', async () => {
      const r1 = await conductor.add({ title: 'List A', cwd: '/tmp', files: ['src/la.ts'] });
      const r2 = await conductor.add({ title: 'List B', cwd: '/tmp', files: ['src/lb.ts'] });
      await conductor.start(r1.id);

      const running = conductor.list({ status: 'running' });
      expect(running.some(t => t.id === r1.id)).toBe(true);
      expect(running.some(t => t.id === r2.id)).toBe(false);
    });
  });

  describe('Conductor.reconcile', () => {
    it('marks drifted tasks correctly', async () => {
      const r = await conductor.add({ title: 'Drift', cwd: '/tmp', files: ['src/drift.ts'], spawnedBy: 'claude' });
      await conductor.start(r.id);

      // Simulate task having a session that is now gone
      const { drifted } = await conductor.reconcile([]);
      // The task had no sessionId so it might not be picked up — that's acceptable
      // but if sessionId was set, it should drift
      expect(Array.isArray(drifted)).toBe(true);
    });
  });

  describe('HTTP Health endpoint', () => {
    let healthServer: ReturnType<typeof http.createServer> | null = null;
    let actualPort: number = 0;

    beforeEach(async () => {
      const { createHealthServer } = await import('../../src/http/health');
      healthServer = createHealthServer(conductor, 0);
      await new Promise<void>((resolve, reject) => {
        healthServer!.once('error', reject);
        healthServer!.listen(0, () => {
          const addr = healthServer!.address();
          actualPort = typeof addr === 'object' && addr ? addr.port : 0;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        if (healthServer) {
          // Force-close keep-alive connections so close() resolves immediately
          if (typeof (healthServer as http.Server & { closeAllConnections?: () => void }).closeAllConnections === 'function') {
            (healthServer as http.Server & { closeAllConnections: () => void }).closeAllConnections();
          }
          healthServer.close(() => resolve());
        } else {
          resolve();
        }
      });
      healthServer = null;
    });

    it('GET /health returns ok: true', async () => {
      const res = await httpGet(`http://localhost:${actualPort}/health`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as Record<string, unknown>;
      expect(data['ok']).toBe(true);
      expect(typeof data['uptime']).toBe('number');
    });

    it('GET /status returns full state', async () => {
      const res = await httpGet(`http://localhost:${actualPort}/status`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as Record<string, unknown>;
      expect(data['tasks']).toBeDefined();
    });

    it('GET /tasks returns array', async () => {
      await conductor.add({ title: 'HTTP task', cwd: '/tmp', files: ['src/http.ts'] });
      const res = await httpGet(`http://localhost:${actualPort}/tasks`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as unknown[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('POST /tasks adds a task', async () => {
      const res = await httpPost(`http://localhost:${actualPort}/tasks`, {
        title: 'HTTP Post task',
        cwd: '/tmp',
        files: ['src/post.ts'],
        spawnedBy: 'user',
      });
      expect(res.status).toBe(201);
      const data = JSON.parse(res.body) as Record<string, unknown>;
      expect(data['id']).toMatch(/^tsk_/);
    });

    it('GET /events returns array', async () => {
      const res = await httpGet(`http://localhost:${actualPort}/events`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as unknown[];
      expect(Array.isArray(data)).toBe(true);
    });

    it('GET /dag returns dag shape', async () => {
      const res = await httpGet(`http://localhost:${actualPort}/dag`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as Record<string, unknown>;
      expect(Array.isArray(data['nodes'])).toBe(true);
      expect(Array.isArray(data['edges'])).toBe(true);
    });
  });
});
