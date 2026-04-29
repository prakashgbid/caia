/**
 * CODING-007 — runtime smoke tests.
 *
 * Exercises register → poll → dispatch → shutdown without spinning up a
 * real orchestrator. Uses an in-memory OrchestratorClient stand-in.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { startRuntime } from '../src/runtime';
import type { OrchestratorClient } from '../src/orchestrator-client';

interface FakeBackend {
  register: jest.Mock;
  heartbeat: jest.Mock;
  getAssignment: jest.Mock;
  release: jest.Mock;
}

function makeFakeClient(): { fake: FakeBackend; client: OrchestratorClient } {
  const fake: FakeBackend = {
    register: jest.fn().mockResolvedValue({ workerId: 'wkr_42' }),
    heartbeat: jest.fn().mockResolvedValue({ ok: true, status: 'idle', currentStoryId: null }),
    getAssignment: jest.fn().mockResolvedValue({ assignment: null }),
    release: jest.fn().mockResolvedValue({ ok: true }),
  };
  const client = fake as unknown as OrchestratorClient;
  return { fake, client };
}

function tmpSocketDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'caia-rt-'));
}

describe('runtime', () => {
  it('registers, starts IPC, polls, and shuts down cleanly', async () => {
    const { fake, client } = makeFakeClient();
    const dir = tmpSocketDir();
    const sock = path.join(dir, 'wkr_42.sock');
    const handlers = {
      applyFix: jest.fn().mockResolvedValue({ status: 'fix-applied', sha: 's', turns: 1, totalTokens: { input: 0, output: 0 } }),
      getStatus: () => ({ status: 'idle' as const, currentStoryId: null }),
      flushLogs: () => [],
      shutdown: jest.fn().mockResolvedValue(undefined),
    };
    const handle = await startRuntime({
      orchestratorUrl: 'http://orc:7776',
      client,
      socketPath: sock,
      preferredWorkerId: 'wkr_42',
      ipcHandlers: handlers,
      onAssignment: jest.fn(),
      log: () => {},
    });
    try {
      expect(fake.register).toHaveBeenCalledTimes(1);
      expect(handle.workerId).toBe('wkr_42');
      expect(fs.existsSync(sock)).toBe(true);
      await handle.heartbeatOnce();
      expect(fake.heartbeat).toHaveBeenCalledWith('wkr_42');
      await handle.pollOnce();
      expect(fake.getAssignment).toHaveBeenCalledWith('wkr_42');
    } finally {
      await handle.shutdown();
    }
    expect(fake.release).toHaveBeenCalledWith('wkr_42', { reason: 'manual-shutdown' });
    expect(fs.existsSync(sock)).toBe(false);
  });

  it('dispatches an assignment exactly once per storyId', async () => {
    const { fake, client } = makeFakeClient();
    fake.getAssignment
      .mockResolvedValueOnce({ assignment: null })
      .mockResolvedValueOnce({ assignment: { storyId: 's_1', bucketId: 'b', assignedAt: 1 } })
      .mockResolvedValueOnce({ assignment: { storyId: 's_1', bucketId: 'b', assignedAt: 1 } })
      .mockResolvedValueOnce({ assignment: { storyId: 's_2', bucketId: 'b', assignedAt: 2 } });
    const dir = tmpSocketDir();
    const sock = path.join(dir, 'wkr_42.sock');
    const onAssignment = jest.fn().mockResolvedValue(undefined);
    const handle = await startRuntime({
      orchestratorUrl: 'http://orc:7776',
      client,
      socketPath: sock,
      preferredWorkerId: 'wkr_42',
      ipcHandlers: {
        applyFix: jest.fn(),
        getStatus: () => ({ status: 'idle' as const, currentStoryId: null }),
        flushLogs: () => [],
        shutdown: jest.fn(),
      },
      onAssignment,
      log: () => {},
    });
    try {
      await handle.pollOnce(); // null
      await handle.pollOnce(); // s_1
      await handle.pollOnce(); // s_1 again — must NOT re-dispatch
      await handle.pollOnce(); // s_2
      expect(onAssignment).toHaveBeenCalledTimes(2);
      expect(onAssignment.mock.calls[0]![0].storyId).toBe('s_1');
      expect(onAssignment.mock.calls[1]![0].storyId).toBe('s_2');
    } finally {
      await handle.shutdown();
    }
  });

  it('survives a heartbeat failure without aborting subsequent polls', async () => {
    const { fake, client } = makeFakeClient();
    fake.heartbeat.mockRejectedValueOnce(new Error('upstream 503'));
    const dir = tmpSocketDir();
    const sock = path.join(dir, 'wkr_42.sock');
    const logged: string[] = [];
    const handle = await startRuntime({
      orchestratorUrl: 'http://orc:7776',
      client,
      socketPath: sock,
      preferredWorkerId: 'wkr_42',
      ipcHandlers: {
        applyFix: jest.fn(),
        getStatus: () => ({ status: 'idle' as const, currentStoryId: null }),
        flushLogs: () => [],
        shutdown: jest.fn(),
      },
      onAssignment: jest.fn(),
      log: (l) => logged.push(l),
    });
    try {
      await handle.heartbeatOnce();
      await handle.pollOnce();
      expect(logged.some((l) => l.includes('heartbeat failed'))).toBe(true);
      expect(fake.getAssignment).toHaveBeenCalled();
    } finally {
      await handle.shutdown();
    }
  });

  it('shutdown is idempotent', async () => {
    const { client, fake } = makeFakeClient();
    const dir = tmpSocketDir();
    const sock = path.join(dir, 'wkr_42.sock');
    const handle = await startRuntime({
      orchestratorUrl: 'http://orc:7776',
      client,
      socketPath: sock,
      preferredWorkerId: 'wkr_42',
      ipcHandlers: {
        applyFix: jest.fn(),
        getStatus: () => ({ status: 'idle' as const, currentStoryId: null }),
        flushLogs: () => [],
        shutdown: jest.fn(),
      },
      onAssignment: jest.fn(),
      log: () => {},
    });
    await handle.shutdown('task-completed');
    await handle.shutdown('manual-shutdown');
    expect(fake.release).toHaveBeenCalledTimes(1);
    expect(fake.release).toHaveBeenCalledWith('wkr_42', { reason: 'task-completed' });
  });
});
