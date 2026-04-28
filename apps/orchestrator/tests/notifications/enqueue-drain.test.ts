import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotificationQueue, resetNotificationQueue } from '../../src/notifications/index';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-notif-test-'));
}

describe('NotificationQueue', () => {
  let tmpDir: string;
  let queue: NotificationQueue;

  beforeEach(() => {
    tmpDir = makeTempDir();
    resetNotificationQueue();
    queue = new NotificationQueue(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetNotificationQueue();
  });

  describe('enqueue', () => {
    it('returns a notification with id, ts, and kind', () => {
      const notif = queue.enqueue('req_001', 'started', 'Task started');
      expect(notif.id).toMatch(/^notif_/);
      expect(notif.kind).toBe('started');
      expect(notif.message).toBe('Task started');
      expect(notif.requirementId).toBe('req_001');
      expect(notif.ts).toBeTruthy();
    });

    it('increments pending count', () => {
      expect(queue.pendingCount()).toBe(0);
      queue.enqueue('req_001', 'started', 'A');
      expect(queue.pendingCount()).toBe(1);
      queue.enqueue('req_002', 'completed', 'B');
      expect(queue.pendingCount()).toBe(2);
    });

    it('stores all required fields', () => {
      const notif = queue.enqueue('req_abc', 'progress', 'Half done', 'chat');
      expect(notif.channel).toBe('chat');
      expect(notif.requirementId).toBe('req_abc');
    });

    it('defaults channel to both', () => {
      const notif = queue.enqueue('req_001', 'started', 'msg');
      expect(notif.channel).toBe('both');
    });
  });

  describe('drain', () => {
    it('returns all pending notifications', () => {
      queue.enqueue('req_001', 'started', 'A');
      queue.enqueue('req_002', 'completed', 'B');
      queue.enqueue('req_003', 'blocked', 'C');
      const drained = queue.drain();
      expect(drained).toHaveLength(3);
    });

    it('clears the queue after drain', () => {
      queue.enqueue('req_001', 'started', 'A');
      queue.drain();
      expect(queue.pendingCount()).toBe(0);
    });

    it('returns empty array when nothing pending', () => {
      const drained = queue.drain();
      expect(drained).toHaveLength(0);
    });

    it('drains are idempotent — second drain returns empty', () => {
      queue.enqueue('req_001', 'started', 'A');
      const first = queue.drain();
      const second = queue.drain();
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
    });

    it('preserves notification order', () => {
      queue.enqueue('req_001', 'started', 'first');
      queue.enqueue('req_002', 'completed', 'second');
      const drained = queue.drain();
      expect(drained[0]!.message).toBe('first');
      expect(drained[1]!.message).toBe('second');
    });
  });

  describe('channel handling', () => {
    it('enqueues chat-only without crashing', () => {
      expect(() => queue.enqueue('req_001', 'started', 'msg', 'chat')).not.toThrow();
    });

    it('enqueues native-only (osascript may fail gracefully in CI)', () => {
      expect(() => queue.enqueue('req_001', 'started', 'msg', 'native')).not.toThrow();
    });

    it('enqueues both channel without crashing', () => {
      expect(() => queue.enqueue('req_001', 'started', 'msg', 'both')).not.toThrow();
    });
  });

  describe('all notification kinds', () => {
    const kinds = ['started', 'progress', 'completed', 'blocked'] as const;
    for (const kind of kinds) {
      it(`enqueues kind: ${kind}`, () => {
        const n = queue.enqueue('req_x', kind, `${kind} message`);
        expect(n.kind).toBe(kind);
      });
    }
  });
});
