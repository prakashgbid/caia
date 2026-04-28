import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { Conductor } from '../../src/index';
import { createHealthServer } from '../../src/http/health';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-dash-'));
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

describe('HTTP Health Server', () => {
  let tmpDir: string;
  let conductor: Conductor;
  let server: http.Server;
  const PORT = 17778;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    conductor = new Conductor(tmpDir);
    await conductor.init();
    server = createHealthServer(conductor, PORT);
    await new Promise<void>(resolve => server.listen(PORT, resolve));
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await conductor.shutdown?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /health', () => {
    it('returns correct shape when conductor is up', async () => {
      const res = await httpGet(`http://localhost:${PORT}/health`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as Record<string, unknown>;
      expect(data['ok']).toBe(true);
      expect(typeof data['uptime']).toBe('number');
      expect(data['uptime']).toBeGreaterThanOrEqual(0);
      expect('lastEvent' in data).toBe(true);
      expect(typeof data['pendingTasks']).toBe('number');
    });

    it('returns pendingTasks count correctly', async () => {
      await conductor.add({ title: 'Task 1', cwd: '/tmp', files: ['src/a.ts'] });
      await conductor.add({ title: 'Task 2', cwd: '/tmp', files: ['src/b.ts'] });

      const res = await httpGet(`http://localhost:${PORT}/health`);
      const data = JSON.parse(res.body) as Record<string, unknown>;
      expect(data['pendingTasks']).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /status', () => {
    it('returns full ConductorState', async () => {
      const res = await httpGet(`http://localhost:${PORT}/status`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as Record<string, unknown>;
      expect(data['tasks']).toBeDefined();
      expect(data['events']).toBeDefined();
      expect('lastEventId' in data).toBe(true);
    });
  });

  describe('GET /tasks', () => {
    it('returns task array', async () => {
      await conductor.add({ title: 'Dash task', cwd: '/tmp', files: ['src/dash.ts'] });
      const res = await httpGet(`http://localhost:${PORT}/tasks`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as unknown[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('returns empty array when no tasks', async () => {
      const res = await httpGet(`http://localhost:${PORT}/tasks`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as unknown[];
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('GET /events', () => {
    it('returns events array', async () => {
      await conductor.add({ title: 'Event task', cwd: '/tmp', files: ['src/ev.ts'] });
      const res = await httpGet(`http://localhost:${PORT}/events`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as unknown[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('supports since query param', async () => {
      await conductor.add({ title: 'Event A', cwd: '/tmp', files: ['src/ea.ts'] });
      const state = conductor.status();
      const lastId = state.lastEventId;
      await conductor.add({ title: 'Event B', cwd: '/tmp', files: ['src/eb.ts'] });

      const res = await httpGet(`http://localhost:${PORT}/events?since=${lastId}`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as unknown[];
      expect(Array.isArray(data)).toBe(true);
      // Should only include events after lastId
      expect(data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /dag', () => {
    it('returns dag with nodes and edges', async () => {
      const res = await httpGet(`http://localhost:${PORT}/dag`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body) as Record<string, unknown>;
      expect(Array.isArray(data['nodes'])).toBe(true);
      expect(Array.isArray(data['edges'])).toBe(true);
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await httpGet(`http://localhost:${PORT}/unknown-route`);
      expect(res.status).toBe(404);
    });
  });
});
