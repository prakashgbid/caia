import { nanoid } from 'nanoid';
import type { Db } from './connection';
import { adrs } from './schema';
import { eq } from 'drizzle-orm';

export async function seedAdr011(db: Db): Promise<void> {
  const existing = db.select().from(adrs).where(eq(adrs.number, 11)).all();
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  db.insert(adrs).values({
    id: 'adr_' + nanoid(8),
    number: 11,
    title: 'Conductor Backend Evolution to SQLite + Hono + WebSocket',
    status: 'accepted',
    context: 'Conductor started as a JSONL-based event-sourced system. As the project grew, we needed SQL query capabilities, real-time push notifications to the dashboard, and a clean path to cloud deployment.',
    decision: 'Adopt SQLite (via Drizzle ORM) as the primary store, Hono as the HTTP framework, and native ws for WebSocket push. All new entities (ADRs, Business Features, Proactive Suggestions, Timeline, Audit Log, Projects) go directly to SQLite. Existing JSONL managers remain in place for backward compatibility.',
    consequences: 'Dashboard gets real-time updates via WebSocket. SQLite can be swapped to Postgres by changing CONDUCTOR_DB_URL and the Drizzle driver. Hono can be deployed to Cloudflare Workers. JSONL layer is kept for existing test compatibility.',
    alternatives: JSON.stringify([
      'PostgreSQL from day 1 (rejected: overkill for local-first)',
      'Express instead of Hono (rejected: heavier, not Workers-native)',
      'Socket.io instead of ws (rejected: heavier, unnecessary features)',
    ]),
    projectId: null,
    scope: 'global',
    createdAt: now,
    updatedAt: now,
  }).run();
}
