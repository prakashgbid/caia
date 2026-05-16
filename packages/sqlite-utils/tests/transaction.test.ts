import { describe, expect, it } from 'vitest';

import { openDb } from '../src/open.js';
import { withTransaction } from '../src/transaction.js';

function freshDb() {
  const db = openDb(':memory:');
  db.exec('CREATE TABLE counter (id INTEGER PRIMARY KEY, v INTEGER NOT NULL)');
  db.prepare('INSERT INTO counter (id, v) VALUES (1, 0)').run();
  return db;
}

describe('withTransaction', () => {
  it('runs fn and commits its writes', () => {
    const db = freshDb();
    try {
      const out = withTransaction(db, () => {
        db.prepare('UPDATE counter SET v = v + 1 WHERE id = 1').run();
        return (db.prepare('SELECT v FROM counter WHERE id = 1').get() as { v: number }).v;
      });
      expect(out).toBe(1);
      const row = db.prepare('SELECT v FROM counter WHERE id = 1').get() as { v: number };
      expect(row.v).toBe(1);
    } finally {
      db.close();
    }
  });

  it('rolls back when fn throws', () => {
    const db = freshDb();
    try {
      expect(() =>
        withTransaction(db, () => {
          db.prepare('UPDATE counter SET v = 99 WHERE id = 1').run();
          throw new Error('boom');
        }),
      ).toThrow('boom');
      const row = db.prepare('SELECT v FROM counter WHERE id = 1').get() as { v: number };
      expect(row.v).toBe(0);
    } finally {
      db.close();
    }
  });

  it('returns fn return value', () => {
    const db = freshDb();
    try {
      const out = withTransaction(db, () => ({ ok: true as const, n: 42 }));
      expect(out).toEqual({ ok: true, n: 42 });
    } finally {
      db.close();
    }
  });

  it('honours mode=immediate', () => {
    const db = freshDb();
    try {
      const out = withTransaction(
        db,
        () => {
          db.prepare('UPDATE counter SET v = 5 WHERE id = 1').run();
          return 'ok';
        },
        { mode: 'immediate' },
      );
      expect(out).toBe('ok');
      const row = db.prepare('SELECT v FROM counter WHERE id = 1').get() as { v: number };
      expect(row.v).toBe(5);
    } finally {
      db.close();
    }
  });

  it('honours mode=exclusive', () => {
    const db = freshDb();
    try {
      withTransaction(
        db,
        () => {
          db.prepare('UPDATE counter SET v = 7 WHERE id = 1').run();
        },
        { mode: 'exclusive' },
      );
      const row = db.prepare('SELECT v FROM counter WHERE id = 1').get() as { v: number };
      expect(row.v).toBe(7);
    } finally {
      db.close();
    }
  });

  it('honours mode=deferred (explicit)', () => {
    const db = freshDb();
    try {
      withTransaction(
        db,
        () => {
          db.prepare('UPDATE counter SET v = 3 WHERE id = 1').run();
        },
        { mode: 'deferred' },
      );
      const row = db.prepare('SELECT v FROM counter WHERE id = 1').get() as { v: number };
      expect(row.v).toBe(3);
    } finally {
      db.close();
    }
  });
});
